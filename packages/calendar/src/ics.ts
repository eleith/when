import { generateIcsCalendar, type IcsCalendar, type IcsEvent } from 'ts-ics';
import { systemClock, type Clock } from './clock.js';
import { originId, type Appointment, type AppointmentStatus } from '@when/db';

export type IcsMethod = 'REQUEST' | 'CANCEL';

export interface IcsInput {
	appointment: Appointment;
	eventTypeName: string;
	organizerName: string;
	organizerEmail: string;
	/** Public URL the booker can use to cancel or reschedule. */
	cancelUrl: string;
	/**
	 * Set for scheduling messages (iMIP email attachments, user-downloaded
	 * ICS): emits a calendar-level `METHOD` line and forces the corresponding
	 * event STATUS. Leave undefined for a calendar object resource (e.g. a
	 * CalDAV PUT body) — RFC 5545 forbids METHOD on stored objects, and many
	 * servers (Nextcloud, Radicale) reject such PUTs with 415.
	 */
	method?: IcsMethod;
	clock?: Clock;
}

export function buildIcs(input: IcsInput): string {
	const { appointment, eventTypeName, organizerName, organizerEmail, cancelUrl, method } = input;
	const clock = input.clock ?? systemClock;

	const event: IcsEvent = {
		uid: originId(appointment),
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
		events: [event]
	};
	if (method) calendar.method = method;

	return generateIcsCalendar(calendar);
}

function eventStatus(
	method: IcsMethod | undefined,
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
