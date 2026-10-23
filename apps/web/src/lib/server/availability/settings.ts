import type { Meeting, WhenConfiguration } from '@when/config';
import { expandWeekly } from './expand-weekly';
import type { AvailabilitySettings } from './types';
import type { AppointmentRole } from '../appointment/actions';

export function resolveAvailabilityLimits(
	meeting: Meeting,
	role: AppointmentRole
): Pick<AvailabilitySettings, 'buffer_before' | 'buffer_after' | 'max_appointments_per_day'> {
	if (role === 'host') {
		return { buffer_before: 0, buffer_after: 0, max_appointments_per_day: null };
	}
	return {
		buffer_before: meeting.padding_before_minutes,
		buffer_after: meeting.padding_after_minutes,
		max_appointments_per_day: meeting.daily_booking_limit
	};
}

export function resolveAvailabilitySettingsById(
	cfg: WhenConfiguration,
	meetingName: string,
	role: AppointmentRole
): AvailabilitySettings {
	const et = cfg.meetings[meetingName];
	if (!et) throw new Error(`unknown meeting name: ${meetingName}`);
	return resolveAvailabilitySettings(cfg, et, role);
}

export function resolveAvailabilitySettings(
	cfg: WhenConfiguration,
	et: Meeting,
	role: AppointmentRole
): AvailabilitySettings {
	const a = cfg.schedules[et.schedule];
	if (!a) throw new Error(`unknown schedule name: ${et.schedule}`);
	const limits = resolveAvailabilityLimits(et, role);
	return {
		duration: et.duration_minutes,
		slot_granularity: et.start_times_every_minutes,
		minimum_notice: et.notice_minutes,
		maximum_lookahead: et.booking_window_days,
		...limits,
		weekly: expandWeekly(a.weekly)
	};
}
