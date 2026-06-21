import type { Kysely } from 'kysely';
import {
	getOpenWorkflow,
	sendAppointmentEmail,
	syncCalendars,
	purgeAppointment,
	type AppointmentEmailKind,
	type PurgeAppointmentRow
} from '@when/jobs';
import type { Appointment, Database } from '@when/db';

// Snapshots the appointment as it stands now (so the email reflects this moment),
// then enqueues the send. Takes an id, not a row, so it's callable from anywhere.
export async function enqueueAppointmentEmail(
	db: Kysely<Database>,
	appointmentId: string,
	kind: AppointmentEmailKind
): Promise<Appointment> {
	const appointment = await db
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', appointmentId)
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

// Wake the worker's calendar sync. A unique key per call so each appointment change
// triggers a scan (the scan re-reads the DB, so duplicates are harmless and the
// scanner collapses bursts).
export async function enqueueCalendarSync(): Promise<void> {
	await getOpenWorkflow().runWorkflow(
		syncCalendars,
		{},
		{ idempotencyKey: `sync-calendars:${crypto.randomUUID()}` }
	);
}

export async function enqueuePurgeAppointment(rows: PurgeAppointmentRow[]): Promise<void> {
	const chainKey = rows
		.map((r) => r.id)
		.sort()
		.join(',');
	await getOpenWorkflow().runWorkflow(
		purgeAppointment,
		{ rows },
		{ idempotencyKey: `purge:${chainKey}` }
	);
}
