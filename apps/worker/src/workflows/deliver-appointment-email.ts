import { defineWorkflowSpec, type RetryPolicy } from 'openworkflow';
import type { AppointmentEmailKind, WorkflowSpec } from '@when/jobs';
import type { Envelope, RecipientRole } from '../email/recipients.js';
import { systemClock, type Clock } from '../email/clock.js';
import { recordSendOutcome } from '../email/status.js';
import { getWorkerContext } from '../services/context.js';
import { appendEmailJobLog } from '../services/job-log.js';
import { implementObservedWorkflow, emailsTotal } from '../services/metrics.js';

export interface DeliverAppointmentEmailInput {
	appointmentId: string;
	kind: AppointmentEmailKind;
	role: RecipientRole;
	envelope: Envelope;
}

export type DeliverAppointmentEmailResult = 'sent' | 'skipped';

export const deliverAppointmentEmail: WorkflowSpec<
	DeliverAppointmentEmailInput,
	DeliverAppointmentEmailResult
> = defineWorkflowSpec({ name: 'deliver-appointment-email' });

interface DeliveryStep {
	run<T>(
		config: { name: string; retryPolicy?: Partial<RetryPolicy> },
		fn: () => Promise<T> | T
	): Promise<T>;
}

export async function runDeliverAppointmentEmail(
	input: DeliverAppointmentEmailInput,
	step: DeliveryStep,
	clock: Pick<Clock, 'now'> = systemClock
): Promise<DeliverAppointmentEmailResult> {
	const ctx = getWorkerContext();
	const outcome = await step.run(
		{
			name: 'smtp',
			retryPolicy: {
				maximumAttempts: 5,
				initialInterval: '30s',
				backoffCoefficient: 2,
				maximumInterval: '10m'
			}
		},
		async () => {
			const row = await ctx.db
				.selectFrom('appointments')
				.select('id')
				.where('id', '=', input.appointmentId)
				.where('status', '!=', 'purged')
				.executeTakeFirst();
			if (!row) return 'skipped' as const;

			const result = await ctx.mailer.send(input.envelope);
			const deliveryStatus = result.ok ? 'success' : 'failure';
			emailsTotal.inc({
				recipient_type: input.role,
				email_kind: input.kind,
				status: deliveryStatus
			});
			if (!result.ok) {
				await recordSendOutcome(ctx, result, clock);
				await appendEmailJobLog(ctx.db, input.appointmentId, 'failed', clock.now().toISOString());
				throw new Error(result.reason);
			}
			return 'sent' as const;
		}
	);

	if (outcome === 'sent') {
		await step.run({ name: 'smtp:status' }, () => recordSendOutcome(ctx, { ok: true }, clock));
	}
	return outcome;
}

export function registerDeliverAppointmentEmailWorkflow(): void {
	implementObservedWorkflow(deliverAppointmentEmail, ({ input, step }) =>
		runDeliverAppointmentEmail(input, step)
	);
}
