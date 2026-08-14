import type { Kysely } from 'kysely';
import {
	getOpenWorkflow,
	reconcileAppointment,
	syncCalendars,
	purgeAppointment,
	type AppointmentEmailKind,
	type PurgeAppointmentRow
} from '@when/jobs';
import type { Appointment, Database } from '@when/db';

// Enqueues the targeted reconciliation workflow for a specific appointment.
// Coordinates video chat, calendar sync, and notification emails in the correct order.
export async function enqueueAppointmentReconciliation(
	db: Kysely<Database>,
	appointmentId: string,
	emailKind?: AppointmentEmailKind,
	cleanupVideoChatUrl?: string | null
): Promise<Appointment> {
	const appointment = await db
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', appointmentId)
		.executeTakeFirstOrThrow();

	await getOpenWorkflow().runWorkflow(
		reconcileAppointment,
		{ appointmentId, emailKind, cleanupVideoChatUrl },
		// Bumping by ics_sequence ensures reschedules get distinct runs and aren't swallowed by queue dedup.
		{
			idempotencyKey: emailKind
				? `${appointmentId}:${emailKind}:${appointment.ics_sequence}`
				: `${appointmentId}:sync:${appointment.ics_sequence}`
		}
	);

	return appointment as Appointment;
}

// Wake the worker's calendar sync scanner.
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
