import { enqueueAppointmentEmail, enqueueCalendarSync } from '../workflow';
import { newAppointmentId, newCancelToken } from './ids';
import type { AppointmentContext } from './context';
import type { GuestAnswer, EventType } from '@when/config';
import { createActionLog, type Appointment } from '@when/db';
import type { AppointmentEmailKind } from '@when/jobs';

export interface CreateAppointmentInput {
	eventType: EventType;
	start: string;
	end: string;
	guest: { name: string; email: string | null; answers: GuestAnswer[]; timezone: string };
	location: string | null;
	initiator?: 'host' | 'guest';
}

export type CreateAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'slot_taken' };

function isUniqueViolation(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const msg = String((err as { message?: unknown }).message ?? '');
	return /UNIQUE constraint failed/i.test(msg);
}

export async function createAppointment(
	ctx: AppointmentContext,
	input: CreateAppointmentInput
): Promise<CreateAppointmentResult> {
	const id = newAppointmentId();
	const cancelToken = newCancelToken();
	const eventType = input.eventType;
	const status =
		eventType.appointment_flow === 'requires_confirmation' && input.initiator !== 'host'
			? 'pending'
			: 'confirmed';
	const now = ctx.clock.now().toISOString();
	const initialLog = createActionLog([
		{
			action: 'create',
			actor: input.initiator ?? 'guest',
			at: now
		}
	]);

	let appointment: Appointment;
	try {
		appointment = await ctx.db
			.insertInto('appointments')
			.values({
				id,
				event_type_id: eventType.id,
				start_time: input.start,
				end_time: input.end,
				guest_name: input.guest.name,
				guest_email: input.guest.email,
				guest_answers: input.guest.answers.length ? JSON.stringify(input.guest.answers) : null,
				guest_timezone: input.guest.timezone,
				location: input.location,
				note: eventType.note ?? null,
				conference: eventType.conference ?? null,
				status,
				origin_id: id,
				cancel_token: cancelToken,
				action_log: initialLog,
				external_event_id: null,
				external_calendar_id: null,
				event_type_snapshot: JSON.stringify(eventType)
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	} catch (err) {
		if (isUniqueViolation(err)) return { ok: false, reason: 'slot_taken' };
		throw err;
	}

	const kind: AppointmentEmailKind = status === 'confirmed' ? 'confirmed' : 'pending';
	appointment = await enqueueAppointmentEmail(ctx.db, appointment.id, kind);
	if (status === 'confirmed') await enqueueCalendarSync();

	return { ok: true, appointment };
}
