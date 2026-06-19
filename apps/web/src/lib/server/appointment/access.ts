import { error } from '@sveltejs/kit';
import type { Appointment, AppointmentStatus } from '@when/db';

export const APPOINTMENT_VIEW_GRACE_DAYS = 14;

const ACTIVE_STATUSES: ReadonlySet<AppointmentStatus> = new Set(['pending', 'confirmed']);

const DAY_MS = 24 * 60 * 60 * 1000;

export function isViewable(row: Pick<Appointment, 'end_time'>, now: Date): boolean {
	const endMs = Date.parse(row.end_time);
	if (Number.isNaN(endMs)) return false;
	return now.getTime() < endMs + APPOINTMENT_VIEW_GRACE_DAYS * DAY_MS;
}

export function isCancelAllowed(
	row: Pick<Appointment, 'start_time' | 'status'>,
	now: Date
): boolean {
	if (!ACTIVE_STATUSES.has(row.status)) return false;
	const startMs = Date.parse(row.start_time);
	if (Number.isNaN(startMs)) return false;
	return now.getTime() < startMs;
}

export function isRescheduleAllowed(
	row: Pick<Appointment, 'start_time' | 'status'>,
	now: Date,
	minimumNoticeMinutes: number
): boolean {
	if (!ACTIVE_STATUSES.has(row.status)) return false;
	const startMs = Date.parse(row.start_time);
	if (Number.isNaN(startMs)) return false;
	return now.getTime() + minimumNoticeMinutes * 60 * 1000 <= startMs;
}

export function requireViewableAppointment<
	T extends Pick<Appointment, 'cancel_token' | 'end_time'>
>(row: T | undefined, token: string | null, now: Date): T {
	if (!row || !token || row.cancel_token !== token) error(404);
	if (!isViewable(row, now)) error(404);
	return row;
}
