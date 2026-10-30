import type { Kysely } from 'kysely';
import { getBusyIntervals, type Appointment, type BusyInterval, type Database } from '@when/db';
import { busyCalendarsFor } from '@when/calendar';
import type { Meeting, WhenConfiguration } from '@when/config';
import { systemClock } from '#lib/server/clock.js';
import { computeSlots, type ComputeOptions } from './calc';
import { mergeBlocks } from './intervals';
import { loadAppointmentBlocks } from './blocks';
import { resolveAvailabilitySettings } from './settings';
import { buildBaseWindows, candidateDates } from './windows';
import type { AvailabilitySettings } from './types';
import type { AppointmentRole } from '../appointment/actions';
import { resolveBookingDurations, type BookingDurations } from '../appointment/duration';

export interface Availability {
	settings: AvailabilitySettings;
	bookingDurations: BookingDurations;
	slotsByDuration: Record<number, Record<string, string[]>>;
	workingWindows: { start: string; end: string }[];
	busyBlocks: { start: string; end: string }[];
}

export async function loadAvailability(
	db: Kysely<Database>,
	cfg: WhenConfiguration,
	slug: string,
	eventType: Meeting,
	role: AppointmentRole,
	currentAppointment: Pick<Appointment, 'start_time' | 'end_time'> | null = null
): Promise<Availability> {
	const { options, bookingDurations } = await readAvailabilityInputs(
		db,
		cfg,
		slug,
		eventType,
		role,
		currentAppointment
	);
	const { settings, rangeStart, rangeEnd, userTz } = options;
	const slotsByDuration: Record<number, Record<string, string[]>> = {};
	for (const duration of bookingDurations.durations) {
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
	return { settings, bookingDurations, slotsByDuration, workingWindows, busyBlocks };
}

// Keep creation's day-bounded busy read distinct from rescheduling's full horizon.
export async function isNewSlotBookable(
	db: Kysely<Database>,
	cfg: WhenConfiguration,
	slug: string,
	eventType: Meeting,
	role: AppointmentRole,
	slot: string,
	duration: number
): Promise<boolean> {
	const busyWindow = slotDayWindow(slot, cfg.user.timezone);
	const { options, bookingDurations } = await readAvailabilityInputs(
		db,
		cfg,
		slug,
		eventType,
		role,
		null,
		busyWindow
	);
	return isOfferedSlot(options, bookingDurations.durations, slot, duration);
}

export async function isRescheduleSlotBookable(
	db: Kysely<Database>,
	cfg: WhenConfiguration,
	slug: string,
	eventType: Meeting,
	role: AppointmentRole,
	slot: string,
	duration: number,
	currentAppointment: Pick<Appointment, 'start_time' | 'end_time'>
): Promise<boolean> {
	const { options, bookingDurations } = await readAvailabilityInputs(
		db,
		cfg,
		slug,
		eventType,
		role,
		currentAppointment
	);
	return isOfferedSlot(options, bookingDurations.durations, slot, duration);
}

async function readAvailabilityInputs(
	db: Kysely<Database>,
	cfg: WhenConfiguration,
	slug: string,
	eventType: Meeting,
	role: AppointmentRole,
	currentAppointment: Pick<Appointment, 'start_time' | 'end_time'> | null,
	remoteBusyWindow?: BusyInterval
): Promise<{ options: ComputeOptions; bookingDurations: BookingDurations }> {
	const settings = resolveAvailabilitySettings(cfg, eventType, role);
	const bookingDurations = resolveBookingDurations(eventType, role, currentAppointment);
	const now = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
	const rangeEnd = now.add({ hours: 24 * settings.maximum_lookahead });
	const blocks = await loadAppointmentBlocks(
		db,
		slug,
		now,
		rangeEnd,
		cfg.user.timezone,
		currentAppointment?.start_time ?? null
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
		bookingDurations
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
