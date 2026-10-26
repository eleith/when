import { durationsOf, type Meeting } from '@when/config';
import type { Appointment } from '@when/db';
import type { AppointmentRole } from './actions';

const HOST_DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 300];

export interface BookingDurations {
	defaultDuration: number;
	durations: number[];
}

export function resolveBookingDurations(
	eventType: Meeting,
	role: AppointmentRole,
	currentAppointment: Pick<Appointment, 'start_time' | 'end_time'> | null = null
): BookingDurations {
	const defaultDuration = currentAppointment
		? (Date.parse(currentAppointment.end_time) - Date.parse(currentAppointment.start_time)) / 60_000
		: eventType.duration_minutes;
	const choices = durationsOf(eventType);
	if (role === 'host') choices.push(...HOST_DURATIONS);
	choices.push(defaultDuration);
	const durations = [...new Set(choices)].sort((a, b) => a - b);
	return { defaultDuration, durations };
}

export function resolveDuration(
	eventType: Meeting,
	role: AppointmentRole,
	form: FormData,
	currentAppointment: Pick<Appointment, 'start_time' | 'end_time'> | null = null
): number | null {
	const { defaultDuration, durations } = resolveBookingDurations(
		eventType,
		role,
		currentAppointment
	);
	const raw = form.get('duration');
	if (raw === null || raw === '') return defaultDuration;
	const value = Number(raw);
	return durations.includes(value) ? value : null;
}
