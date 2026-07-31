import { getBusyIntervals } from '@when/db';
import { busyCalendarsFor } from '@when/calendar';
import { durationsOf, type Meeting, type WhenConfiguration } from '@when/config';
import { systemClock } from '$lib/server/clock';
import { getDb } from '$lib/server/state';
import { computeSlots } from './calc';
import { mergeBlocks } from './intervals';
import { loadAppointmentBlocks } from './blocks';
import { resolveAvailabilitySettings } from './settings';
import { buildBaseWindows, candidateDates } from './windows';
import type { AvailabilitySettings } from './types';

export interface Availability {
	settings: AvailabilitySettings;
	durations: number[];
	slotsByDuration: Record<number, Record<string, string[]>>;
	workingWindows: { start: string; end: string }[];
	busyBlocks: { start: string; end: string }[];
}

export async function loadAvailability(
	cfg: WhenConfiguration,
	eventType: Meeting,
	excludeStart: string | null = null
): Promise<Availability> {
	const settings = resolveAvailabilitySettings(cfg, eventType);
	const userTz = cfg.user.timezone;
	const nowInstant = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
	const rangeEnd = nowInstant.add({ hours: 24 * settings.maximum_lookahead });

	const blocks = await loadAppointmentBlocks(
		getDb(),
		eventType.name,
		nowInstant,
		rangeEnd,
		userTz,
		excludeStart
	);

	const remoteBusy = (
		await getBusyIntervals(getDb(), busyCalendarsFor(eventType), {
			start: nowInstant.toString(),
			end: rangeEnd.toString()
		})
	).map((b) => ({ start: Temporal.Instant.from(b.start), end: Temporal.Instant.from(b.end) }));

	// Busy data is length-independent; run the engine once per offered length.
	const durations = durationsOf(eventType);
	const slotsByDuration: Record<number, Record<string, string[]>> = {};
	for (const duration of durations) {
		const slots = computeSlots({
			settings: { ...settings, duration },
			rangeStart: nowInstant,
			rangeEnd,
			userTz,
			now: nowInstant,
			existingAppointments: blocks.appointments,
			remoteBusy,
			perDayCount: blocks.perDayCount
		});
		const byDate: Record<string, string[]> = {};
		for (const s of slots) {
			const date = s.toZonedDateTimeISO(userTz).toPlainDate().toString();
			(byDate[date] ??= []).push(s.toString());
		}
		slotsByDuration[duration] = byDate;
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

	return { settings, durations, slotsByDuration, workingWindows, busyBlocks };
}

// Re-check, at submit time, that a slot is still on offer. `excludeStart` drops the
// appointment's own current slot so a reschedule can land on its existing time window.
export async function isSlotBookable(
	cfg: WhenConfiguration,
	eventType: Meeting,
	slot: string,
	duration: number,
	excludeStart: string | null = null
): Promise<boolean> {
	const { slotsByDuration } = await loadAvailability(cfg, eventType, excludeStart);
	return Object.values(slotsByDuration[duration] ?? {})
		.flat()
		.includes(slot);
}
