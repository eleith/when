import { generateIcsCalendar, type IcsCalendar, type IcsEvent } from 'ts-ics';
import { systemClock, type Clock } from './clock';
import type { Appointment, AppointmentStatus } from './db';

export type IcsMethod = 'REQUEST' | 'CANCEL';

export interface IcsInput {
	appointment: Appointment;
	eventTypeName: string;
	organizerName: string;
	organizerEmail: string;
	/** Public URL the booker can use to cancel or reschedule. */
	cancelUrl: string;
	method: IcsMethod;
	clock?: Clock;
}

export function buildIcs(input: IcsInput): string {
	const { appointment, eventTypeName, organizerName, organizerEmail, cancelUrl, method } = input;
	const clock = input.clock ?? systemClock;

	const event: IcsEvent = {
		uid: appointment.id,
		sequence: appointment.ics_sequence,
		summary: eventTypeName,
		start: { date: new Date(appointment.start_time), type: 'DATE-TIME' },
		end: { date: new Date(appointment.end_time), type: 'DATE-TIME' },
		stamp: { date: clock.now(), type: 'DATE-TIME' },
		description: buildDescription(appointment, cancelUrl),
		location: appointment.location ?? undefined,
		organizer: { name: organizerName, email: organizerEmail },
		attendees: [{ email: appointment.attendee_email, name: appointment.attendee_name }],
		status: eventStatus(method, appointment.status)
	};

	const calendar: IcsCalendar = {
		prodId: '-//When//EN',
		version: '2.0',
		method,
		events: [event]
	};

	return generateIcsCalendar(calendar);
}

function eventStatus(
	method: IcsMethod,
	appointmentStatus: AppointmentStatus
): 'CANCELLED' | 'TENTATIVE' | 'CONFIRMED' {
	if (method === 'CANCEL') return 'CANCELLED';
	if (appointmentStatus === 'pending') return 'TENTATIVE';
	return 'CONFIRMED';
}

function buildDescription(appointment: Appointment, cancelUrl: string): string {
	const parts: string[] = [];
	if (appointment.attendee_notes) parts.push(appointment.attendee_notes);
	parts.push(`Reschedule or cancel: ${cancelUrl}`);
	return parts.join('\n\n');
}
