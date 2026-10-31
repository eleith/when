import { defineWorkflowSpec, type RetryPolicy } from 'openworkflow';
import type { AppointmentEmailKind, WorkflowSpec } from '@when/jobs';
import type { Envelope, RecipientRole } from '../email/recipients.js';
import { systemClock, type Clock } from '../email/clock.js';
import { recordSendOutcome } from '../email/status.js';
import { getWorkerContext } from '../services/context.js';
import { appendEmailJobLog } from '../services/job-log.js';
import { implementWorkflow } from '../services/workflow-registration.js';
import { sendAppointmentEmail } from '../services/email.js';

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
	const sentAt = await step.run(
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
			if (!row) return null;

			const result = await sendAppointmentEmail(ctx.mailer, input.envelope, input.role, input.kind);
			const observedAt = clock.now().toISOString();
			if (!result.ok) {
				await recordSendOutcome(ctx, result, observedAt);
				await appendEmailJobLog(ctx.db, input.appointmentId, 'failed', observedAt);
				throw new Error(result.reason);
			}
			return observedAt;
		}
	);

	if (sentAt === null) return 'skipped';
	await step.run({ name: 'smtp:status' }, () => recordSendOutcome(ctx, { ok: true }, sentAt));
	return 'sent';
}

export function registerDeliverAppointmentEmailWorkflow(): void {
	implementWorkflow(deliverAppointmentEmail, ({ input, step }) =>
		runDeliverAppointmentEmail(input, step)
	);
}
