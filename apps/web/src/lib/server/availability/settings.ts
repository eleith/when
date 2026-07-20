import { durationsOf, type Meeting, type WhenConfiguration } from '@when/config';
import { expandWeekly } from './expand-weekly';
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
	const durations = durationsOf(et);
	return {
		duration: durations[0],
		slot_granularity: et.start_times_every_minutes ?? Math.min(...durations),
		minimum_notice: et.notice_minutes ?? 120,
		maximum_lookahead: et.booking_window_days ?? 60,
		buffer_before: et.padding_before_minutes ?? 0,
		buffer_after: et.padding_after_minutes ?? 0,
		max_appointments_per_day: et.daily_booking_limit ?? null,
		weekly: expandWeekly(a.weekly)
	};
}
