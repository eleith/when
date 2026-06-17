import type { Appointment } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { notificationStates } from '$lib/notifications';

export type DisplayStatus =
	| 'pending'
	| 'confirmed'
	| 'in_progress'
	| 'concluded'
	| 'cancelled'
	| 'declined'
	| 'expired'
	| 'rescheduled';

export function deriveDisplayStatus(
	row: Pick<Appointment, 'status' | 'start_time' | 'end_time'>,
	now: Date
): DisplayStatus {
	if (row.status !== 'confirmed') return row.status;
	const nowMs = now.getTime();
	if (nowMs < Date.parse(row.start_time)) return 'confirmed';
	if (nowMs < Date.parse(row.end_time)) return 'in_progress';
	return 'concluded';
}

export function toAppointmentView(row: Appointment, cfg: WhenConfiguration, now: Date) {
	const nowMs = now.getTime();
	const notifications = notificationStates(row);
	return {
		...row,
		event_type_name:
			cfg.event_types.find((e) => e.id === row.event_type_id)?.name ?? row.event_type_id,
		display_status: deriveDisplayStatus(row, now),
		is_past: nowMs >= Date.parse(row.end_time),
		possible_conflict: row.has_possible_conflict === 1,
		notifications
	};
}
