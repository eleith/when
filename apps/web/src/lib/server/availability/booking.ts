import type { Kysely } from 'kysely';
import { getBusyIntervals, type BusyInterval, type Database } from '@when/db';
import { busyCalendarsFor } from '@when/calendar';
import { durationsOf, type Meeting, type WhenConfiguration } from '@when/config';
import { systemClock } from '$lib/server/clock';
import { computeSlots, type ComputeOptions } from './calc';
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
	db: Kysely<Database>,
	cfg: WhenConfiguration,
	slug: string,
	eventType: Meeting,
	excludeStart: string | null = null
): Promise<Availability> {
	const { options, allowedDurations } = await readAvailabilityInputs(
		db,
		cfg,
		slug,
		eventType,
		excludeStart
	);
	const { settings, rangeStart, rangeEnd, userTz } = options;
	const slotsByDuration: Record<number, Record<string, string[]>> = {};
	for (const duration of allowedDurations) {
		const slots = computeSlots({ ...options, settings: { ...settings, duration } });
		const byDate: Record<string, string[]> = {};
		for (const slot of slots) {
			const date = slot.toZonedDateTimeISO(userTz).toPlainDate().toString();
			(byDate[date] ??= []).push(slot.toString());
		}
		slotsByDuration[duration] = byDate;
	}

	const workingWindows: { start: string; end: string }[] = [];
	for (const date of candidateDates(rangeStart, rangeEnd, userTz)) {
		for (const window of buildBaseWindows(date, settings.weekly, userTz)) {
			workingWindows.push({ start: window.start.toString(), end: window.end.toString() });
		}
	}
	const busyBlocks = mergeBlocks([...options.existingAppointments, ...options.remoteBusy]).map(
		(block) => ({ start: block.start.toString(), end: block.end.toString() })
	);
	return { settings, durations: allowedDurations, slotsByDuration, workingWindows, busyBlocks };
}

// Keep creation's day-bounded busy read distinct from rescheduling's full horizon.
export async function isNewSlotBookable(
	db: Kysely<Database>,
	cfg: WhenConfiguration,
	slug: string,
	eventType: Meeting,
	slot: string,
	duration: number
): Promise<boolean> {
	const busyWindow = slotDayWindow(slot, cfg.user.timezone);
	const { options, allowedDurations } = await readAvailabilityInputs(
		db,
		cfg,
		slug,
		eventType,
		null,
		busyWindow
	);
	return isOfferedSlot(options, allowedDurations, slot, duration);
}

export async function isRescheduleSlotBookable(
	db: Kysely<Database>,
	cfg: WhenConfiguration,
	slug: string,
	eventType: Meeting,
	slot: string,
	duration: number,
	excludeStart: string
): Promise<boolean> {
	const { options, allowedDurations } = await readAvailabilityInputs(
		db,
		cfg,
		slug,
		eventType,
		excludeStart
	);
	return isOfferedSlot(options, allowedDurations, slot, duration);
}

async function readAvailabilityInputs(
	db: Kysely<Database>,
	cfg: WhenConfiguration,
	slug: string,
	eventType: Meeting,
	excludeStart: string | null,
	remoteBusyWindow?: BusyInterval
): Promise<{ options: ComputeOptions; allowedDurations: number[] }> {
	const settings = resolveAvailabilitySettings(cfg, eventType);
	const now = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
	const rangeEnd = now.add({ hours: 24 * settings.maximum_lookahead });
	const blocks = await loadAppointmentBlocks(
		db,
		slug,
		now,
		rangeEnd,
		cfg.user.timezone,
		excludeStart
	);
	const busyWindow = remoteBusyWindow ?? { start: now.toString(), end: rangeEnd.toString() };
	const remote = await getBusyIntervals(db, busyCalendarsFor(eventType), busyWindow);
	const remoteBusy = remote.map((block) => ({
		start: Temporal.Instant.from(block.start),
		end: Temporal.Instant.from(block.end)
	}));
	return {
		options: {
			settings,
			rangeStart: now,
			rangeEnd,
			userTz: cfg.user.timezone,
			now,
			existingAppointments: blocks.appointments,
			remoteBusy,
			perDayCount: blocks.perDayCount
		},
		allowedDurations: durationsOf(eventType)
	};
}

function isOfferedSlot(
	options: ComputeOptions,
	allowedDurations: number[],
	slot: string,
	duration: number
): boolean {
	if (!allowedDurations.includes(duration)) return false;
	const slots = computeSlots({ ...options, settings: { ...options.settings, duration } });
	return slots.some((candidate) => candidate.toString() === slot);
}

function slotDayWindow(slot: string, userTz: string): BusyInterval {
	const date = Temporal.Instant.from(slot).toZonedDateTimeISO(userTz).toPlainDate();
	return {
		start: date.toZonedDateTime(userTz).toInstant().toString(),
		end: date.add({ days: 1 }).toZonedDateTime(userTz).toInstant().toString()
	};
}
