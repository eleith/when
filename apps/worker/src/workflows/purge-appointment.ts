import type { RetryPolicy } from 'openworkflow';
import { deleteAppointmentFromCalendar } from '@when/calendar';
import { purgeAppointment } from '@when/jobs/specs';
import type { PurgeAppointmentInput, PurgeAppointmentResult } from '@when/jobs';
import { getWorkerContext } from '../services/context.js';
import { implementObservedWorkflow } from '../services/metrics.js';
import { deleteStandaloneVideoChat } from '../services/video-chat.js';

// ~24h of bounded effort before we give up and orphan the remote event.
const CALENDAR_RETRY: Partial<RetryPolicy> = {
	maximumAttempts: 30,
	initialInterval: '1m',
	backoffCoefficient: 2,
	maximumInterval: '1h'
};

interface PurgeStep {
	run<T>(
		config: { name: string; retryPolicy?: Partial<RetryPolicy> },
		fn: () => Promise<T> | T
	): Promise<T>;
}

export async function runPurgeAppointment(
	input: PurgeAppointmentInput,
	step: PurgeStep
): Promise<PurgeAppointmentResult> {
	const { config, db, logger } = getWorkerContext();

	for (const row of input.rows) {
		const { externalEventId, externalCalendarId } = row;
		if (externalEventId && externalCalendarId) {
			try {
				await step.run({ name: `calendar:${row.id}`, retryPolicy: CALENDAR_RETRY }, async () => {
					const res = await deleteAppointmentFromCalendar(
						config,
						externalCalendarId,
						externalEventId
					);
					if (!res.ok) throw new Error(res.reason);
				});
			} catch (err) {
				// Give up but still delete the row; the orphan is logged, not retried forever.
				logger.warn(
					{
						appointmentId: row.id,
						calendarId: externalCalendarId,
						externalEventId,
						error: err instanceof Error ? err.message : String(err)
					},
					'purge left an orphaned calendar event'
				);
			}
		}
		await step.run({ name: `video-chat-cleanup:${row.id}` }, async () => {
			await deleteStandaloneVideoChat(db, row.id, config);
		});
		await step.run({ name: `delete:${row.id}` }, async () => {
			await db.deleteFrom('appointments').where('id', '=', row.id).execute();
		});
	}

	return 'purged';
}

export function registerPurgeAppointmentWorkflow(): void {
	implementObservedWorkflow(purgeAppointment, ({ input, step }) =>
		runPurgeAppointment(input, step)
	);
}
