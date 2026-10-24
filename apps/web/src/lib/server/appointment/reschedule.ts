import { resolveAppointmentActions, isTerminalStatus, type AppointmentRole } from './actions';
import { isRescheduleAllowed, isViewable } from './access';
import { resolveBookingDurations } from './duration';
import { enqueueAppointmentReconciliation } from '../workflow';
import type { AppointmentContext } from './context';
import {
	rescheduleAppointmentTransition,
	type RescheduleDetails,
	type RescheduleGuest
} from './transitions';
import type { ParsedAppointment } from './form.server';
import type { Meeting } from '@when/config';
import { findAppointment, withWriteTransaction, type Appointment } from '@when/db';

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
	slug: string;
	eventType: Pick<Meeting, 'notice_minutes'>;
	now: Date;
}

export interface RescheduleAppointmentInput {
	appointmentId: string;
	initiator: AppointmentRole;
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
	let result: RescheduleAppointmentResult;
	try {
		result = await withWriteTransaction(ctx.db, async (connection) => {
			const appointment = await findAppointment(connection, input.appointmentId);
			if (!appointment) return { ok: false, reason: 'conflict' } as const;
			const eventType = ctx.cfg.meetings[appointment.event_type_id];
			const now = ctx.clock.now();
			const gate = resolveAppointmentActions({
				row: appointment,
				role: input.initiator,
				now,
				eventType
			}).reschedule;
			if (!gate.allowed) return { ok: false, reason: 'gated' } as const;
			// A concurrent duration edit can revoke the old booked-length exception.
			if (eventType) {
				const duration = (Date.parse(input.newEnd) - Date.parse(input.newStart)) / 60_000;
				const profile = resolveBookingDurations(eventType, input.initiator, appointment);
				if (!profile.durations.includes(duration)) return { ok: false, reason: 'gated' } as const;
			}

			const details = rescheduleDetails(appointment, input, eventType);
			const moved = await rescheduleAppointmentTransition(
				connection,
				appointment,
				input.initiator,
				now.toISOString(),
				details
			);
			return moved;
		});
	} catch (err) {
		if (isUniqueViolation(err)) return { ok: false, reason: 'slot_taken' };
		throw err;
	}
	if (!result.ok) return result;

	const kind = input.initiator === 'host' ? 'rescheduled-by-host' : 'rescheduled-by-guest';
	await enqueueAppointmentReconciliation(result.appointment, kind);

	return { ok: true, appointment: result.appointment };
}

function rescheduleDetails(
	appointment: Appointment,
	input: RescheduleAppointmentInput,
	eventType: Meeting | undefined
): RescheduleDetails {
	// Host moves confirm; guest moves can re-arm approval on a confirmed appointment.
	let newStatus = appointment.status;
	if (input.initiator === 'host') {
		newStatus = 'confirmed';
	} else if (eventType?.require_approval && appointment.status === 'confirmed') {
		newStatus = 'pending';
	}

	let eventTypeSnapshot = '{}';
	if (eventType) {
		eventTypeSnapshot = JSON.stringify({
			title: eventType.title,
			duration_minutes: eventType.duration_minutes,
			description: eventType.description,
			slug: appointment.event_type_id
		});
	}

	let guestOverride: RescheduleGuest | undefined;
	if (input.guest) {
		const answers = input.guest.answers.length ? JSON.stringify(input.guest.answers) : null;
		guestOverride = {
			name: input.guest.name,
			email: input.guest.email,
			answers,
			location: input.guest.location,
			timezone: input.timezone ?? appointment.guest_timezone
		};
	}

	return {
		newStart: input.newStart,
		newEnd: input.newEnd,
		newStatus,
		eventTypeSnapshot,
		reason: input.reason,
		guest: guestOverride
	};
}

export function classifyReschedule({
	rescheduleId,
	token,
	existing,
	slug,
	eventType,
	now
}: ClassifyRescheduleInput): RescheduleContext {
	if (!rescheduleId) return { kind: 'fresh' };

	if (!token || !existing || existing.cancel_token !== token) {
		return { kind: 'error', code: 'token' };
	}
	if (existing.event_type_id !== slug) {
		return { kind: 'error', code: 'event_type' };
	}
	if (!isViewable(existing, now)) {
		return { kind: 'error', code: 'past_window' };
	}
	if (isTerminalStatus(existing.status)) {
		return { kind: 'error', code: 'terminal' };
	}
	if (!isRescheduleAllowed(existing, now, eventType.notice_minutes)) {
		return { kind: 'error', code: 'minimum_notice' };
	}
	return { kind: 'reschedule' };
}
