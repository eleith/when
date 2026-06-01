import type { EventType } from '@when/config';
import type { Appointment, AppointmentStatus } from '$lib/server/db';
import { isCancelAllowed, isRescheduleAllowed } from './access';

export type ActionReason = 'past_start' | 'minimum_notice' | 'terminal_status' | 'wrong_viewer';

export type ActionGate = { allowed: true } | { allowed: false; reason: ActionReason };

export interface BookingActions {
	cancel: ActionGate;
	reschedule: ActionGate;
	accept: ActionGate;
	decline: ActionGate;
}

export type Viewer = 'attendee' | 'organizer';

export interface ResolveBookingActionsInput {
	row: Pick<Appointment, 'status' | 'start_time'>;
	viewer: Viewer;
	now: Date;
	eventType: Pick<EventType, 'minimum_notice'> | undefined;
}

const ALLOWED: ActionGate = { allowed: true };

function isActiveStatus(status: AppointmentStatus): boolean {
	return status === 'pending' || status === 'confirmed';
}

function resolveCancel(row: Pick<Appointment, 'status' | 'start_time'>, now: Date): ActionGate {
	if (isCancelAllowed(row, now)) return ALLOWED;
	if (!isActiveStatus(row.status)) return { allowed: false, reason: 'terminal_status' };
	return { allowed: false, reason: 'past_start' };
}

function resolveReschedule(
	row: Pick<Appointment, 'status' | 'start_time'>,
	now: Date,
	minimumNoticeMinutes: number
): ActionGate {
	if (isRescheduleAllowed(row, now, minimumNoticeMinutes)) return ALLOWED;
	if (!isActiveStatus(row.status)) return { allowed: false, reason: 'terminal_status' };
	if (now.getTime() >= Date.parse(row.start_time)) return { allowed: false, reason: 'past_start' };
	return { allowed: false, reason: 'minimum_notice' };
}

function resolveOrganizerDecision(
	row: Pick<Appointment, 'status' | 'start_time'>,
	viewer: Viewer,
	now: Date
): ActionGate {
	if (viewer !== 'organizer') return { allowed: false, reason: 'wrong_viewer' };
	if (row.status !== 'pending') return { allowed: false, reason: 'terminal_status' };
	if (now.getTime() >= Date.parse(row.start_time)) return { allowed: false, reason: 'past_start' };
	return ALLOWED;
}

export function resolveBookingActions({
	row,
	viewer,
	now,
	eventType
}: ResolveBookingActionsInput): BookingActions {
	const minimumNotice = eventType?.minimum_notice ?? 0;
	const decision = resolveOrganizerDecision(row, viewer, now);
	return {
		cancel: resolveCancel(row, now),
		reschedule: resolveReschedule(row, now, minimumNotice),
		accept: decision,
		decline: decision
	};
}
