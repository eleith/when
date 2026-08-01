import type { RetryPolicy } from 'openworkflow';
import { reconcileAppointment } from '@when/jobs';
import type { ReconcileAppointmentInput, ReconcileAppointmentResult } from '@when/jobs';
import { dispatch } from '../email/dispatch.js';
import { getWorkerContext } from '../services/context.js';
import { appendJobLog } from '../services/job-log.js';
import { recordSendOutcome } from '../email/status.js';
import { createStandaloneVideoChat } from '../services/video-chat.js';
import { reconcileAppointment as syncCalendarForAppointment } from '../calendar/sync.js';
import { implementObservedWorkflow, emailsTotal } from '../services/metrics.js';

const SEND_RETRY: Partial<RetryPolicy> = {
	maximumAttempts: 5,
	initialInterval: '30s',
	backoffCoefficient: 2,
	maximumInterval: '10m'
};

interface ReconcileStep {
	run<T>(
		config: { name: string; retryPolicy?: Partial<RetryPolicy> },
		fn: () => Promise<T> | T
	): Promise<T>;
}

export async function runReconcileAppointment(
	input: ReconcileAppointmentInput,
	step: ReconcileStep
): Promise<ReconcileAppointmentResult> {
	const ctx = getWorkerContext();

	// 1. Resolve Standalone Video Chat (Nextcloud Talk)
	const resolvedRow = await step.run({ name: 'resolve-video-chat' }, () =>
		createStandaloneVideoChat(ctx.db, input.appointmentId, ctx.config)
	);

	// 2. Sync Calendar (which also handles Google Meet generation)
	await step.run({ name: 'sync-calendar' }, () => syncCalendarForAppointment(ctx, resolvedRow));

	// 3. Send email if requested
	if (input.emailKind) {
		// Fetch the latest state (which has resolved video chat link and external event details)
		const finalRow = await ctx.db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', input.appointmentId)
			.executeTakeFirstOrThrow();

		const envelopes = await dispatch({ kind: input.emailKind, appointment: finalRow }, ctx.config);
		let allSent = true;

		for (const envelope of envelopes) {
			const recipientType = envelope.to === ctx.config.user.email ? 'host' : 'guest';
			try {
				await step.run({ name: `smtp:${recipientType}`, retryPolicy: SEND_RETRY }, async () => {
					const result = await ctx.mailer.send(envelope);
					await recordSendOutcome(ctx, result);
					if (!result.ok) {
						emailsTotal.inc({
							recipient_type: recipientType,
							email_kind: input.emailKind!,
							status: 'failure'
						});
						throw new Error(result.reason);
					}
					emailsTotal.inc({
						recipient_type: recipientType,
						email_kind: input.emailKind!,
						status: 'success'
					});
				});
			} catch (err) {
				allSent = false;
				ctx.logger.error(
					{
						appointmentId: input.appointmentId,
						recipientType,
						error: err instanceof Error ? err.message : String(err)
					},
					'appointment email send failed after retries'
				);
			}
		}

		await step.run({ name: 'log:result' }, () =>
			appendJobLog(
				ctx.db,
				input.appointmentId,
				'email',
				allSent ? 'done' : 'failed',
				Temporal.Now.instant().toString()
			)
		);
	}

	return 'reconciled';
}

export function registerReconcileAppointmentWorkflow(): void {
	implementObservedWorkflow(reconcileAppointment, ({ input, step }) =>
		runReconcileAppointment(input, step)
	);
}
