import type { Meeting } from '@when/config';
import type { Appointment, AppointmentStatus } from '@when/db';
import { isCancelAllowed, isRescheduleAllowed } from './access';

export type ActionReason =
	| 'past_start'
	| 'minimum_notice'
	| 'terminal_status'
	| 'wrong_role'
	| 'not_configured';

export type ActionGate = { allowed: true } | { allowed: false; reason: ActionReason };

export interface AppointmentActions {
	cancel: ActionGate;
	reschedule: ActionGate;
	accept: ActionGate;
	decline: ActionGate;
	generateVideoChat: ActionGate;
}

export type AppointmentRole = 'guest' | 'host';

export interface ResolveAppointmentActionsInput {
	row: Pick<Appointment, 'status' | 'start_time'>;
	role: AppointmentRole;
	now: Date;
	eventType: Pick<Meeting, 'notice_minutes' | 'video_chat'> | undefined;
}

const ALLOWED: ActionGate = { allowed: true };

export function isActiveStatus(status: AppointmentStatus): boolean {
	return status === 'pending' || status === 'confirmed';
}

export function isTerminalStatus(status: AppointmentStatus): boolean {
	return !isActiveStatus(status);
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

function resolveHostDecision(
	row: Pick<Appointment, 'status' | 'start_time'>,
	role: AppointmentRole,
	now: Date
): ActionGate {
	if (role !== 'host') return { allowed: false, reason: 'wrong_role' };
	if (row.status !== 'pending') return { allowed: false, reason: 'terminal_status' };
	if (now.getTime() >= Date.parse(row.start_time)) return { allowed: false, reason: 'past_start' };
	return ALLOWED;
}

export function resolveGenerateVideoChat(
	row: Pick<Appointment, 'status'>,
	role: AppointmentRole,
	videoChat: Meeting['video_chat'] | undefined
): ActionGate {
	if (role !== 'host') return { allowed: false, reason: 'wrong_role' };
	if (!isActiveStatus(row.status)) return { allowed: false, reason: 'terminal_status' };
	if (!videoChat) return { allowed: false, reason: 'not_configured' };
	return ALLOWED;
}

export function resolveAppointmentActions({
	row,
	role,
	now,
	eventType
}: ResolveAppointmentActionsInput): AppointmentActions {
	const minimumNotice = eventType?.notice_minutes ?? 0;
	const decision = resolveHostDecision(row, role, now);
	return {
		cancel: resolveCancel(row, now),
		reschedule: resolveReschedule(row, now, minimumNotice),
		accept: decision,
		decline: decision,
		generateVideoChat: resolveGenerateVideoChat(row, role, eventType?.video_chat)
	};
}
