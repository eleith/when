import { sql, type Kysely } from 'kysely';
import {
	originId,
	appendActionLogSql,
	parseActionLog,
	type ActionLogEntry,
	type Appointment,
	type AppointmentStatus,
	type Database
} from '@when/db';
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
			calendar_revision: sql`calendar_revision + 1`,
			action_log: appendActionLogSql({ action: 'confirm', actor: 'host', at: now }),
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
export interface RescheduleGuest {
	name: string;
	email: string | null;
	answers: string | null;
	location: string | null;
	timezone: string | null;
}

export async function rescheduleAppointmentTransition(
	db: Kysely<Database>,
	old: Appointment,
	actor: 'guest' | 'host',
	now: string,
	when: {
		newStart: string;
		newEnd: string;
		newStatus: AppointmentStatus;
		guest?: RescheduleGuest;
		eventTypeSnapshot: string;
		reason?: string;
	}
): Promise<RescheduleResult> {
	const newId = newAppointmentId();
	const newToken = newCancelToken();
	const guest: RescheduleGuest = when.guest ?? {
		name: old.guest_name,
		email: old.guest_email,
		answers: old.guest_answers,
		location: old.location,
		timezone: old.guest_timezone
	};

	const rescheduleEntry: ActionLogEntry = {
		action: 'reschedule',
		actor,
		at: now,
		payload: {
			field: 'status',
			from: old.status,
			to: 'rescheduled',
			note: when.reason || undefined,
			metadata: { next_id: newId, previous_id: old.id }
		}
	};
	const updatedLogJson = JSON.stringify([...parseActionLog(old.action_log), rescheduleEntry]);

	const created = await db.transaction().execute(async (trx) => {
		const terminated = await trx
			.updateTable('appointments')
			.set({
				status: 'rescheduled',
				action_log: updatedLogJson,
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
				guest_name: guest.name,
				guest_email: guest.email,
				guest_answers: guest.answers,
				guest_timezone: guest.timezone,
				location: guest.location,
				status: when.newStatus,
				video_chat: old.video_chat,
				origin_id: originId(old),
				cancel_token: newToken,
				action_log: updatedLogJson,
				external_event_id: old.external_event_id,
				external_calendar_id: old.external_calendar_id,
				event_type_snapshot: when.eventTypeSnapshot,
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
	actor: 'guest' | 'host',
	now: string,
	reason?: string
): Promise<TransitionOutcome> {
	const result = await db
		.updateTable('appointments')
		.set({
			status: 'cancelled',
			ics_sequence: sql`ics_sequence + 1`,
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

export interface PurgeChainRow {
	id: string;
	external_event_id: string | null;
	external_calendar_id: string | null;
}

// Null when nothing changed (already purged) so the caller can no-op.
export async function purgeChainTransition(
	db: Kysely<Database>,
	chainOriginId: string
): Promise<PurgeChainRow[] | null> {
	return db.transaction().execute(async (trx) => {
		const rows = await trx
			.selectFrom('appointments')
			.select(['id', 'external_event_id', 'external_calendar_id'])
			.where((eb) => eb('origin_id', '=', chainOriginId).or('id', '=', chainOriginId))
			.where('status', '!=', 'purged')
			.execute();
		if (rows.length === 0) return null;
		await trx
			.updateTable('appointments')
			.set({ status: 'purged', updated_at: sql`CURRENT_TIMESTAMP` })
			.where((eb) => eb('origin_id', '=', chainOriginId).or('id', '=', chainOriginId))
			.where('status', '!=', 'purged')
			.execute();
		return rows;
	});
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
			calendar_revision: sql`calendar_revision + 1`,
			action_log: appendActionLogSql({ action: 'decline', actor: 'host', at: now }),
			updated_at: sql`CURRENT_TIMESTAMP`
		})
		.where('id', '=', id)
		.where('status', 'in', ['pending'])
		.executeTakeFirst();
	return classify(db, id, result.numUpdatedRows);
}
