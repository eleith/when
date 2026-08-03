import { enqueueAppointmentReconciliation } from '../workflow';
import { newAppointmentId, newCancelToken } from './ids';
import type { AppointmentContext } from './context';
import type { GuestAnswer, Meeting } from '@when/config';
import { createActionLog, type Appointment } from '@when/db';
import type { AppointmentEmailKind } from '@when/jobs';
import { resolveAppointmentVideoChat } from './video-chat';

export interface CreateAppointmentInput {
	slug: string;
	eventType: Meeting;
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
	const status = eventType.require_approval && input.initiator !== 'host' ? 'pending' : 'confirmed';
	const now = ctx.clock.now().toISOString();
	const initialLog = createActionLog([
		{
			action: 'create',
			actor: input.initiator ?? 'guest',
			at: now
		}
	]);

	const dbVideoChat = resolveAppointmentVideoChat(eventType, ctx.cfg);

	let appointment: Appointment;
	try {
		appointment = await ctx.db
			.insertInto('appointments')
			.values({
				id,
				event_type_id: input.slug,
				start_time: input.start,
				end_time: input.end,
				guest_name: input.guest.name,
				guest_email: input.guest.email,
				guest_answers: input.guest.answers.length ? JSON.stringify(input.guest.answers) : null,
				guest_timezone: input.guest.timezone,
				location: input.location,
				note: eventType.note ?? null,
				video_chat: dbVideoChat,
				status,
				origin_id: id,
				cancel_token: cancelToken,
				action_log: initialLog,
				external_event_id: null,
				external_calendar_id: null,
				meeting_snapshot: JSON.stringify({
					title: eventType.title,
					duration_minutes: Temporal.Instant.from(input.start)
						.until(Temporal.Instant.from(input.end))
						.total('minutes'),
					description: eventType.description,
					slug: input.slug
				})
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	} catch (err) {
		if (isUniqueViolation(err)) return { ok: false, reason: 'slot_taken' };
		throw err;
	}

	const kind: AppointmentEmailKind = status === 'confirmed' ? 'confirmed' : 'pending';
	appointment = await enqueueAppointmentReconciliation(ctx.db, appointment.id, kind);

	return { ok: true, appointment };
}
