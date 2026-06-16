import { resolveBookingActions, type Viewer } from './actions';
import { isRescheduleAllowed, isViewable } from './access';
import { enqueueBookingEmail, enqueueCalendarSync } from '../workflow';
import type { BookingContext } from './context';
import { rescheduleBooking, type RescheduleResult } from './transitions';
import type { EventType } from '@when/config';
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
	eventType: Pick<EventType, 'id' | 'minimum_notice'>;
	now: Date;
}

export interface RescheduleAppointmentInput {
	appointment: Appointment;
	initiator: Viewer;
	/** New start_time as ISO instant (caller has validated availability). */
	newStart: string;
	/** New end_time as ISO instant. */
	newEnd: string;
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
	ctx: BookingContext,
	input: RescheduleAppointmentInput
): Promise<RescheduleAppointmentResult> {
	const eventType = ctx.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

	const gate = resolveBookingActions({
		row: input.appointment,
		viewer: input.initiator,
		now: ctx.clock.now(),
		eventType
	}).reschedule;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	// An attendee moving a confirmed booking on a requires-confirmation event needs the
	// organizer to re-approve the new time, so the new occurrence starts pending. Organizer
	// moves and auto-flow events keep their status.
	const needsReapproval =
		input.initiator === 'attendee' &&
		eventType?.booking_flow === 'requires_confirmation' &&
		input.appointment.status === 'confirmed';
	const newStatus = needsReapproval ? 'pending' : input.appointment.status;

	let result: RescheduleResult;
	try {
		result = await rescheduleBooking(ctx.db, input.appointment, {
			newStart: input.newStart,
			newEnd: input.newEnd,
			newStatus
		});
	} catch (err) {
		if (isUniqueViolation(err)) return { ok: false, reason: 'slot_taken' };
		throw err;
	}
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const kind =
		input.initiator === 'organizer' ? 'rescheduled-by-organizer' : 'rescheduled-by-attendee';
	const appointment = await enqueueBookingEmail(ctx.db, result.appointment.id, kind);
	await enqueueCalendarSync();

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
	if (existing.event_type_id !== eventType.id) {
		return { kind: 'error', code: 'event_type' };
	}
	if (!isViewable(existing, now)) {
		return { kind: 'error', code: 'past_window' };
	}
	if (
		existing.status === 'cancelled' ||
		existing.status === 'declined' ||
		existing.status === 'expired' ||
		existing.status === 'rescheduled'
	) {
		return { kind: 'error', code: 'terminal' };
	}
	if (!isRescheduleAllowed(existing, now, eventType.minimum_notice ?? 0)) {
		return { kind: 'error', code: 'minimum_notice' };
	}
	return { kind: 'reschedule' };
}
