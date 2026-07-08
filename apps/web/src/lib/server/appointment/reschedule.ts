import { resolveAppointmentActions, isTerminalStatus, type Viewer } from './actions';
import { isRescheduleAllowed, isViewable } from './access';
import { enqueueAppointmentReconciliation } from '../workflow';
import type { AppointmentContext } from './context';
import { rescheduleAppointmentTransition, type RescheduleResult } from './transitions';
import type { ParsedAppointment } from './form.server';
import type { Meeting } from '@when/config';
import type { Appointment } from '@when/db';

export type RescheduleErrorCode =
	| 'token'
	| 'event_type'
	| 'past_window'
	| 'terminal'
	| 'minimum_notice';

export type RescheduleContext =
	| { kind: 'fresh' }
	| { kind: 'reschedule' }
	| { kind: 'error'; code: RescheduleErrorCode };

export interface ClassifyRescheduleInput {
	rescheduleId: string | null;
	token: string | null;
	existing: Appointment | undefined;
	eventType: Pick<Meeting, 'name' | 'notice_minutes'>;
	now: Date;
}

export interface RescheduleAppointmentInput {
	appointment: Appointment;
	initiator: Viewer;
	/** New start_time as ISO instant (caller has validated availability). */
	newStart: string;
	/** New end_time as ISO instant. */
	newEnd: string;
	guest?: ParsedAppointment;
	timezone?: string;
	reason?: string;
}

export type RescheduleAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' | 'slot_taken' };

function isUniqueViolation(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const msg = String((err as { message?: unknown }).message ?? '');
	return /UNIQUE constraint failed/i.test(msg);
}

export async function rescheduleAppointment(
	ctx: AppointmentContext,
	input: RescheduleAppointmentInput
): Promise<RescheduleAppointmentResult> {
	const eventType = ctx.cfg.meetings.find((e) => e.name === input.appointment.event_type_id);

	const gate = resolveAppointmentActions({
		row: input.appointment,
		viewer: input.initiator,
		now: ctx.clock.now(),
		eventType
	}).reschedule;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	// Host reschedules are auto-confirmed. Guest reschedules preserve status,
	// except when moving a confirmed requires-confirmation appointment which re-arms host approval.
	const newStatus =
		input.initiator === 'host'
			? 'confirmed'
			: input.initiator === 'guest' &&
				  eventType?.booking_approval === 'request' &&
				  input.appointment.status === 'confirmed'
				? 'pending'
				: input.appointment.status;

	let result: RescheduleResult;
	try {
		result = await rescheduleAppointmentTransition(
			ctx.db,
			input.appointment,
			input.initiator === 'host' ? 'host' : 'guest',
			ctx.clock.now().toISOString(),
			{
				newStart: input.newStart,
				newEnd: input.newEnd,
				newStatus,
				eventTypeSnapshot: eventType
					? JSON.stringify({
							name: eventType.name,
							duration_minutes: eventType.duration_minutes,
							description: eventType.description,
							slug: eventType.slug
						})
					: '{}',
				reason: input.reason,
				guest: input.guest
					? {
							name: input.guest.name,
							email: input.guest.email,
							answers: input.guest.answers.length ? JSON.stringify(input.guest.answers) : null,
							location: input.guest.location,
							timezone: input.timezone ?? input.appointment.guest_timezone
						}
					: undefined
			}
		);
	} catch (err) {
		if (isUniqueViolation(err)) return { ok: false, reason: 'slot_taken' };
		throw err;
	}
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const kind = input.initiator === 'host' ? 'rescheduled-by-host' : 'rescheduled-by-guest';
	const appointment = await enqueueAppointmentReconciliation(ctx.db, result.appointment.id, kind);

	return { ok: true, appointment };
}

export function classifyReschedule({
	rescheduleId,
	token,
	existing,
	eventType,
	now
}: ClassifyRescheduleInput): RescheduleContext {
	if (!rescheduleId) return { kind: 'fresh' };

	if (!token || !existing || existing.cancel_token !== token) {
		return { kind: 'error', code: 'token' };
	}
	if (existing.event_type_id !== eventType.name) {
		return { kind: 'error', code: 'event_type' };
	}
	if (!isViewable(existing, now)) {
		return { kind: 'error', code: 'past_window' };
	}
	if (isTerminalStatus(existing.status)) {
		return { kind: 'error', code: 'terminal' };
	}
	if (!isRescheduleAllowed(existing, now, eventType.notice_minutes ?? 0)) {
		return { kind: 'error', code: 'minimum_notice' };
	}
	return { kind: 'reschedule' };
}
