import type { Meeting, WhenConfiguration } from '@when/config';
import type { AvailabilitySettings } from './types';

export function resolveAvailabilitySettingsById(
	cfg: WhenConfiguration,
	meetingName: string
): AvailabilitySettings {
	const et = cfg.meetings.find((e) => e.name === meetingName);
	if (!et) throw new Error(`unknown meeting name: ${meetingName}`);
	return resolveAvailabilitySettings(cfg, et);
}

export function resolveAvailabilitySettings(
	cfg: WhenConfiguration,
	et: Meeting
): AvailabilitySettings {
	const a = cfg.schedules.find((p) => p.name === et.schedule);
	if (!a) throw new Error(`unknown schedule name: ${et.schedule}`);
	return {
		duration: et.duration_minutes,
		slot_granularity: et.start_times_every_minutes ?? et.duration_minutes,
		minimum_notice: et.notice_minutes ?? 120,
		maximum_lookahead: et.booking_window_days ?? 60,
		buffer_before: et.padding_before_minutes ?? 0,
		buffer_after: et.padding_after_minutes ?? 0,
		max_appointments_per_day: et.daily_booking_limit ?? null,
		weekly: a.weekly
	};
}
