import { getBusyIntervals } from '@when/db';
import type { EventType, WhenConfiguration } from '@when/config';
import { systemClock } from '$lib/server/clock';
import { getDb } from '$lib/server/state';
import { computeSlots } from './calc';
import { mergeBlocks } from './blocks';
import { loadAppointmentBlocks } from './db-blocks';
import { resolveAvailabilitySettings } from './settings';
import { buildBaseWindows, candidateDates } from './windows';
import type { AvailabilitySettings } from './types';

export interface Availability {
	settings: AvailabilitySettings;
	slotsByDate: Record<string, string[]>;
	workingWindows: { start: string; end: string }[];
	busyBlocks: { start: string; end: string }[];
}

export async function loadAvailability(
	cfg: WhenConfiguration,
	eventType: EventType,
	excludeStart: string | null = null
): Promise<Availability> {
	const settings = resolveAvailabilitySettings(cfg, eventType);
	const userTz = cfg.user.timezone;
	const nowInstant = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
	const rangeEnd = nowInstant.add({ hours: 24 * settings.maximum_lookahead });

	let blocks = await loadAppointmentBlocks(getDb(), eventType.id, nowInstant, rangeEnd, userTz);
	if (excludeStart) {
		blocks = {
			appointments: blocks.appointments.filter((a) => a.start.toString() !== excludeStart),
			perDayCount: blocks.perDayCount
		};
	}

	const remoteBusy = (
		await getBusyIntervals(getDb(), eventType.conflict_calendars ?? [], {
			start: nowInstant.toString(),
			end: rangeEnd.toString()
		})
	).map((b) => ({ start: Temporal.Instant.from(b.start), end: Temporal.Instant.from(b.end) }));

	const slots = computeSlots({
		settings,
		rangeStart: nowInstant,
		rangeEnd,
		userTz,
		now: nowInstant,
		existingAppointments: blocks.appointments,
		remoteBusy,
		perDayCount: blocks.perDayCount
	});

	const slotsByDate: Record<string, string[]> = {};
	for (const s of slots) {
		const date = s.toZonedDateTimeISO(userTz).toPlainDate().toString();
		(slotsByDate[date] ??= []).push(s.toString());
	}

	const dates = candidateDates(nowInstant, rangeEnd, userTz);
	const workingWindows: { start: string; end: string }[] = [];
	for (const date of dates) {
		for (const w of buildBaseWindows(date, settings.weekly, userTz)) {
			workingWindows.push({ start: w.start.toString(), end: w.end.toString() });
		}
	}

	const busyBlocks = mergeBlocks([...blocks.appointments, ...remoteBusy]).map((b) => ({
		start: b.start.toString(),
		end: b.end.toString()
	}));

	return { settings, slotsByDate, workingWindows, busyBlocks };
}

// Re-check, at submit time, that a slot is still on offer. `excludeStart` drops the
// appointment's own current slot so a reschedule can land on its existing time window.
export async function isSlotBookable(
	cfg: WhenConfiguration,
	eventType: EventType,
	slot: string,
	excludeStart: string | null = null
): Promise<boolean> {
	const { slotsByDate } = await loadAvailability(cfg, eventType, excludeStart);
	return Object.values(slotsByDate).flat().includes(slot);
}
