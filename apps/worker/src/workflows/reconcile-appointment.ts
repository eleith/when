import type { RetryPolicy } from 'openworkflow';
import { reconcileAppointment } from '@when/jobs';
import type { ReconcileAppointmentInput, ReconcileAppointmentResult } from '@when/jobs';
import { dispatch } from '../email/dispatch.js';
import { getWorkerContext } from '../services/context.js';
import { appendJobLog } from '../services/job-log.js';
import { parseGuestAnswers } from '@when/config';
import { shouldAttachVideoChat } from '@when/video-chat';
import { recordSendOutcome } from '../email/status.js';
import {
	createStandaloneVideoChat,
	deleteStandaloneVideoChatByUrl
} from '../services/video-chat.js';
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

	let resolvedRow = await ctx.db
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', input.appointmentId)
		.executeTakeFirstOrThrow();

	// 1. Cleanup removed standalone video chat if specified
	if (input.cleanupVideoChatUrl) {
		await step.run({ name: 'cleanup-video-chat' }, () =>
			deleteStandaloneVideoChatByUrl(
				ctx.config,
				resolvedRow.event_type_id,
				input.cleanupVideoChatUrl!
			)
		);
	}

	// 2. Resolve Standalone Video Chat (e.g. Nextcloud Talk) ONLY on initial booking/confirmation
	const isInitialCreation =
		input.emailKind === 'confirmed' ||
		input.emailKind === 'pending' ||
		input.emailKind === 'booked';
	const meeting = ctx.config.meetings[resolvedRow.event_type_id];
	if (isInitialCreation && meeting?.video_chat && !resolvedRow.video_chat) {
		const answers = parseGuestAnswers(resolvedRow.guest_answers);
		if (shouldAttachVideoChat(meeting, ctx.config, answers)) {
			resolvedRow = await step.run({ name: 'resolve-video-chat' }, () =>
				createStandaloneVideoChat(ctx.db, input.appointmentId, ctx.config)
			);
		}
	}

	// 3. Sync Calendar (which also handles Google Meet generation if initially requested)
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
