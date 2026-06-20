import { sql, type Kysely } from 'kysely';
import { originId, appendActionLogSql, createActionLog, type Appointment, type AppointmentStatus, type Database } from '@when/db';
import { newAppointmentId, newCancelToken } from './ids';

export type TransitionOutcome = { ok: true } | { ok: false; reason: 'conflict' | 'not_found' };

export type RescheduleResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'conflict' };

// `numUpdatedRows === 0` means the guarded `where status in (...)` matched nothing:
// either the row is gone (not_found) or someone else moved it first (conflict).
async function classify(
	db: Kysely<Database>,
	id: string,
	numUpdatedRows: bigint
): Promise<TransitionOutcome> {
	if (numUpdatedRows > 0n) return { ok: true };
	const exists = await db
		.selectFrom('appointments')
		.select('id')
		.where('id', '=', id)
		.executeTakeFirst();
	return { ok: false, reason: exists ? 'conflict' : 'not_found' };
}

/** Accept a pending appointment. The worker then creates its calendar event. */
export async function confirmAppointment(
	db: Kysely<Database>,
	id: string,
	now: string
): Promise<TransitionOutcome> {
	const result = await db
		.updateTable('appointments')
		.set({
			status: 'confirmed',
			email_notification_status: null,
			calendar_push_notification_status: 'queued',
			calendar_revision: sql`calendar_revision + 1`,
			action_log: appendActionLogSql({ action: 'confirm', actor: 'organizer', at: now }),
			updated_at: sql`CURRENT_TIMESTAMP`
		})
		.where('id', '=', id)
		.where('status', 'in', ['pending'])
		.executeTakeFirst();
	return classify(db, id, result.numUpdatedRows);
}

/**
 * End the current occurrence and create a linked one at the new time, inheriting the calendar
 * event pointer and `origin_id` so the published event moves rather than being recreated. A taken
 * slot throws UNIQUE (caller maps to `slot_taken`); an already-terminal old row is `conflict`.
 */
export interface RescheduleAttendee {
	name: string;
	email: string | null;
	answers: string | null;
	location: string | null;
	timezone: string | null;
}

export async function rescheduleAppointmentTransition(
	db: Kysely<Database>,
	old: Appointment,
	actor: 'attendee' | 'organizer',
	now: string,
	when: {
		newStart: string;
		newEnd: string;
		newStatus: AppointmentStatus;
		attendee?: RescheduleAttendee;
		eventTypeSnapshot: string;
	}
): Promise<RescheduleResult> {
	const newId = newAppointmentId();
	const newToken = newCancelToken();
	const attendee: RescheduleAttendee = when.attendee ?? {
		name: old.attendee_name,
		email: old.attendee_email,
		answers: old.attendee_answers,
		location: old.location,
		timezone: old.attendee_timezone
	};

	const initialNewLog = createActionLog([
		{
			action: 'create',
			actor,
			at: now,
			payload: {
				metadata: { previous_id: old.id }
			}
		}
	]);

	const created = await db.transaction().execute(async (trx) => {
		const terminated = await trx
			.updateTable('appointments')
			.set({
				status: 'rescheduled',
				rescheduled_to_id: newId,
				action_log: appendActionLogSql({
					action: 'reschedule',
					actor,
					at: now,
					payload: {
						field: 'status',
						from: old.status,
						to: 'rescheduled',
						metadata: { next_id: newId }
					}
				}),
				updated_at: sql`CURRENT_TIMESTAMP`
			})
			.where('id', '=', old.id)
			.where('status', 'in', ['pending', 'confirmed'])
			.executeTakeFirst();
		// old row raced to a terminal state
		if (terminated.numUpdatedRows === 0n) return null;

		return await trx
			.insertInto('appointments')
			.values({
				id: newId,
				event_type_id: old.event_type_id,
				start_time: when.newStart,
				end_time: when.newEnd,
				attendee_name: attendee.name,
				attendee_email: attendee.email,
				attendee_answers: attendee.answers,
				attendee_timezone: attendee.timezone,
				location: attendee.location,
				status: when.newStatus,
				origin_id: originId(old),
				rescheduled_from_id: old.id,
				cancel_token: newToken,
				action_log: initialNewLog,
				external_event_id: old.external_event_id,
				external_calendar_id: old.external_calendar_id,
				event_type_snapshot: when.eventTypeSnapshot,
				calendar_push_notification_status: when.newStatus === 'confirmed' ? 'queued' : null,
				ics_sequence: old.ics_sequence + 1
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	});

	if (!created) return { ok: false, reason: 'conflict' };
	return { ok: true, appointment: created };
}

/** Cancel an appointment. The worker deletes its event if one was published. */
export async function cancelAppointmentTransition(
	db: Kysely<Database>,
	id: string,
	actor: 'attendee' | 'organizer',
	now: string,
	reason?: string
): Promise<TransitionOutcome> {
	const result = await db
		.updateTable('appointments')
		.set({
			status: 'cancelled',
			ics_sequence: sql`ics_sequence + 1`,
			email_notification_status: null,
			// Only worth a sync when there's an event to remove.
			calendar_push_notification_status: sql`CASE WHEN external_event_id IS NOT NULL THEN 'queued' ELSE NULL END`,
			calendar_revision: sql`calendar_revision + 1`,
			action_log: appendActionLogSql({
				action: 'cancel',
				actor,
				at: now,
				payload: reason ? { note: reason } : undefined
			}),
			updated_at: sql`CURRENT_TIMESTAMP`
		})
		.where('id', '=', id)
		.where('status', 'in', ['pending', 'confirmed'])
		.executeTakeFirst();
	return classify(db, id, result.numUpdatedRows);
}

/** Decline a pending request, removing the inherited event if a re-approval revert left one. */
export async function declineAppointmentTransition(
	db: Kysely<Database>,
	id: string,
	now: string
): Promise<TransitionOutcome> {
	const result = await db
		.updateTable('appointments')
		.set({
			status: 'declined',
			ics_sequence: sql`ics_sequence + 1`,
			email_notification_status: null,
			calendar_push_notification_status: sql`CASE WHEN external_event_id IS NOT NULL THEN 'queued' ELSE NULL END`,
			calendar_revision: sql`calendar_revision + 1`,
			action_log: appendActionLogSql({ action: 'decline', actor: 'organizer', at: now }),
			updated_at: sql`CURRENT_TIMESTAMP`
		})
		.where('id', '=', id)
		.where('status', 'in', ['pending'])
		.executeTakeFirst();
	return classify(db, id, result.numUpdatedRows);
}
