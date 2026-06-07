import type { Kysely } from 'kysely';
import { resolveBookingActions, type Viewer } from './actions';
import { isRescheduleAllowed, isViewable } from './access';
import { bookingLinks } from './links';
import { enqueueBookingEmail } from '../workflow';
import { transitionStatus } from './status';
import { pushAppointment } from '@when/calendar';
import type { Clock } from '../clock';
import type { EventType, WhenConfiguration } from '@when/config';
import type { Appointment, Database, NotificationOutcome } from '@when/db';

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

export interface RescheduleAppointmentDeps {
	db: Kysely<Database>;
	cfg: WhenConfiguration;
	clock: Clock;
}

export interface RescheduleAppointmentInput {
	appointment: Appointment;
	initiator: Viewer;
	/** New start_time as ISO instant (caller has validated availability). */
	newStart: string;
	/** New end_time as ISO instant. */
	newEnd: string;
	baseUrl: string;
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
	deps: RescheduleAppointmentDeps,
	input: RescheduleAppointmentInput
): Promise<RescheduleAppointmentResult> {
	const eventType = deps.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

	const gate = resolveBookingActions({
		row: input.appointment,
		viewer: input.initiator,
		now: deps.clock.now(),
		eventType
	}).reschedule;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	let transition: Awaited<ReturnType<typeof transitionStatus>>;
	try {
		transition = await transitionStatus(
			{ db: deps.db, clock: deps.clock },
			{
				id: input.appointment.id,
				from: ['pending', 'confirmed'],
				to: input.appointment.status,
				patch: {
					start_time: input.newStart,
					end_time: input.newEnd,
					ics_sequence: input.appointment.ics_sequence + 1,
					email_notification_status: null,
					calendar_push_notification_status: null
				}
			}
		);
	} catch (err) {
		if (isUniqueViolation(err)) return { ok: false, reason: 'slot_taken' };
		throw err;
	}
	if (!transition.ok) return { ok: false, reason: 'conflict' };

	const updated = transition.row;
	const links = bookingLinks({ baseUrl: input.baseUrl, appointment: updated, eventType });
	let calendarPush: NotificationOutcome | null = null;

	if (updated.external_event_id && updated.external_calendar_id) {
		const pushed = await pushAppointment(deps.cfg, updated, updated.external_calendar_id!, {
			cancelUrl: links.booked
		});
		calendarPush = pushed.ok ? 'ok' : 'failed';
	}

	await deps.db
		.updateTable('appointments')
		.set({
			calendar_push_notification_status: calendarPush,
			updated_at: deps.clock.now().toISOString()
		})
		.where('id', '=', updated.id)
		.execute();

	const kind =
		input.initiator === 'organizer' ? 'rescheduled-by-organizer' : 'rescheduled-by-attendee';
	const appointment = await enqueueBookingEmail(deps.db, {
		kind,
		appointment: { ...updated, calendar_push_notification_status: calendarPush },
		eventType,
		links
	});

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
	if (existing.status === 'cancelled' || existing.status === 'declined') {
		return { kind: 'error', code: 'terminal' };
	}
	if (!isRescheduleAllowed(existing, now, eventType.minimum_notice ?? 0)) {
		return { kind: 'error', code: 'minimum_notice' };
	}
	return { kind: 'reschedule' };
}
