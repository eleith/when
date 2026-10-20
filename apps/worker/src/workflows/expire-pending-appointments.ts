import { expireStalePending } from '@when/db';
import { expirePendingAppointments, type ExpirePendingAppointmentsResult } from '@when/jobs';
import { systemClock, type Clock } from '../email/clock.js';
import { getWorkerContext } from '../services/context.js';
import { implementObservedWorkflow } from '../services/metrics.js';

interface ExpiryStep {
	run<T>(config: { name: string }, fn: () => Promise<T>): Promise<T>;
}

export async function runExpirePendingAppointments(
	step: ExpiryStep,
	clock: Clock = systemClock
): Promise<ExpirePendingAppointmentsResult> {
	await step.run({ name: 'expire-pending-appointments' }, async () => {
		const ctx = getWorkerContext();
		const count = await expireStalePending(ctx.db, clock.now().toISOString());
		if (count > 0) ctx.logger.info({ count }, 'expired stale pending requests');
	});
	return 'expired';
}

export function registerExpirePendingAppointmentsWorkflow(): void {
	implementObservedWorkflow(expirePendingAppointments, ({ step }) =>
		runExpirePendingAppointments(step)
	);
}
