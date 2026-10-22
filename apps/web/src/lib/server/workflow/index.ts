import {
	getOpenWorkflow,
	generateVideoChat,
	reconcileAppointment,
	syncCalendars,
	purgeAppointment,
	type AppointmentEmailKind,
	type PurgeAppointmentRow
} from '@when/jobs';
import type { Appointment } from '@when/db';

// Use the mutation's committed row: a later read can dedupe distinct edits and lose cleanup URLs.
export async function enqueueAppointmentReconciliation(
	appointment: Appointment,
	emailKind?: AppointmentEmailKind,
	cleanupVideoChatUrl?: string | null
): Promise<void> {
	const appointmentId = appointment.id;

	await getOpenWorkflow().runWorkflow(
		reconcileAppointment,
		{ appointmentId, emailKind, cleanupVideoChatUrl },
		// Email follows guest-visible edits; email-free sync also follows standing video choices.
		{
			idempotencyKey: emailKind
				? `${appointmentId}:${emailKind}:${appointment.ics_sequence}`
				: `${appointmentId}:sync:${appointment.calendar_revision}`
		}
	);
}

export async function enqueueVideoChatGeneration(
	appointmentId: string,
	calendarRevision: number
): Promise<void> {
	await getOpenWorkflow().runWorkflow(
		generateVideoChat,
		{ appointmentId },
		{ idempotencyKey: `generate-video-chat:${appointmentId}:${calendarRevision}` }
	);
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
