import type { RetryPolicy } from 'openworkflow';
import { deleteAppointmentFromCalendar } from '@when/calendar';
import { findAppointment, listActiveAppointmentsForCalendarEvent } from '@when/db';
import { purgeAppointment } from '@when/jobs/specs';
import type { PurgeAppointmentInput, PurgeAppointmentResult } from '@when/jobs';
import { getWorkerContext } from '../services/context.js';
import { implementObservedWorkflow } from '../services/metrics.js';
import { cleanupStandaloneVideoChat } from '../services/video-chat-cleanup.js';

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
	const ctx = getWorkerContext();
	const { db } = ctx;

	for (const row of input.rows) {
		await step.run({ name: `video-chat-cleanup:${row.id}` }, async () => {
			await cleanupStandaloneVideoChat(ctx, row.id);
		});
		await step.run({ name: `calendar:${row.id}`, retryPolicy: CALENDAR_RETRY }, async () => {
			// Generation may have recorded a booking after the purge was enqueued.
			const current = await findAppointment(db, row.id);
			const calendarId = current ? current.external_calendar_id : row.externalCalendarId;
			const eventId = current ? current.external_event_id : row.externalEventId;
			if (!calendarId || !eventId) return;
			const active = await listActiveAppointmentsForCalendarEvent(db, { calendarId, eventId });
			if (active.length > 0) return;
			// Deleting the booking also removes its conference; no Google read/detach is needed.
			const deleted = await deleteAppointmentFromCalendar(ctx.config, calendarId, eventId);
			if (!deleted.ok) throw new Error(deleted.reason);
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
