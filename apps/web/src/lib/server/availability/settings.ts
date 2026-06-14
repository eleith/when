import type { EventType, WhenConfiguration } from '@when/config';
import type { AvailabilitySettings } from './types';

export function resolveAvailabilitySettingsById(
	cfg: WhenConfiguration,
	eventTypeId: string
): AvailabilitySettings {
	const et = cfg.event_types.find((e) => e.id === eventTypeId);
	if (!et) throw new Error(`unknown event_type id: ${eventTypeId}`);
	return resolveAvailabilitySettings(cfg, et);
}

export function resolveAvailabilitySettings(
	cfg: WhenConfiguration,
	et: EventType
): AvailabilitySettings {
	const a = cfg.availability;
	return {
		duration: et.duration,
		slot_granularity: et.slot_granularity ?? a.slot_granularity ?? 15,
		minimum_notice: et.minimum_notice ?? a.minimum_notice ?? 120,
		maximum_lookahead: et.maximum_lookahead ?? a.maximum_lookahead ?? 60,
		buffer_before: et.buffer_before ?? a.buffer_before ?? 0,
		buffer_after: et.buffer_after ?? a.buffer_after ?? 0,
		max_bookings_per_day: et.max_bookings_per_day ?? a.max_bookings_per_day ?? null,
		weekly: a.default
	};
}
