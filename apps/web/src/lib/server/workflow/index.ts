import type { Kysely } from 'kysely';
import {
	getOpenWorkflow,
	sendAppointmentEmail,
	syncCalendars,
	type AppointmentEmailKind
} from '@when/jobs';
import type { Appointment, Database } from '@when/db';

// Marks the email queued and snapshots the appointment as it stands now (so the email
// reflects this moment), then enqueues the send. Takes an id, not a row, so it's
// callable from anywhere with an appointment id.
export async function enqueueAppointmentEmail(
	db: Kysely<Database>,
	appointmentId: string,
	kind: AppointmentEmailKind
): Promise<Appointment> {
	const appointment = await db
		.updateTable('appointments')
		.set({ email_notification_status: 'queued' })
		.where('id', '=', appointmentId)
		.returningAll()
		.executeTakeFirstOrThrow();
	await getOpenWorkflow().runWorkflow(
		sendAppointmentEmail,
		{ kind, appointment },
		// ics_sequence bumps on every reschedule, so a repeat same-kind send for the
		// same appointment gets a distinct key and isn't swallowed by the 24h dedup.
		{ idempotencyKey: `${appointmentId}:${kind}:${appointment.ics_sequence}` }
	);
	return appointment as Appointment;
}

// Wake the worker's calendar sync. A unique key per call so each booking change
// triggers a scan (the scan re-reads the DB, so duplicates are harmless and the
// scanner collapses bursts).
export async function enqueueCalendarSync(): Promise<void> {
	await getOpenWorkflow().runWorkflow(
		syncCalendars,
		{},
		{ idempotencyKey: `sync-calendars:${crypto.randomUUID()}` }
	);
}
