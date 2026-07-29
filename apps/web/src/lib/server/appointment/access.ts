import { findChainTip, originId, type Appointment, type AppointmentStatus } from '@when/db';
import type { Kysely } from 'kysely';
import type { Database } from '@when/db';

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

export type ViewableRow = Pick<
	Appointment,
	'id' | 'origin_id' | 'cancel_token' | 'end_time' | 'status'
>;

export async function isViewAllowed(
	db: Kysely<Database>,
	row: ViewableRow,
	token: string | null,
	now: Date
): Promise<boolean> {
	if (!token || row.status === 'purged') return false;

	if (row.cancel_token === token) return isViewable(row, now);

	const tip = row.status === 'rescheduled' ? await findChainTip(db, originId(row)) : row;
	return !!tip && tip.cancel_token === token && isViewable(tip, now);
}
