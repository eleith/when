import { generateIcsCalendar, type IcsCalendar, type IcsEvent } from 'ts-ics';
import type { Appointment } from './db';

export interface IcsInput {
	appointment: Appointment;
	eventTypeName: string;
	organizerName: string;
	organizerEmail: string;
	/** Public URL the booker can use to cancel or reschedule. */
	cancelUrl: string;
}

export function buildIcs(input: IcsInput): string {
	const { appointment, eventTypeName, organizerName, organizerEmail, cancelUrl } = input;

	const event: IcsEvent = {
		uid: appointment.id,
		summary: eventTypeName,
		start: { date: new Date(appointment.start_time), type: 'DATE-TIME' },
		end: { date: new Date(appointment.end_time), type: 'DATE-TIME' },
		stamp: { date: new Date(), type: 'DATE-TIME' },
		description: buildDescription(appointment, cancelUrl),
		location: appointment.location ?? undefined,
		organizer: { name: organizerName, email: organizerEmail },
		attendees: [{ email: appointment.attendee_email, name: appointment.attendee_name }],
		status: appointment.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED'
	};

	const calendar: IcsCalendar = {
		prodId: '-//When//EN',
		version: '2.0',
		events: [event]
	};

	return generateIcsCalendar(calendar);
}

function buildDescription(appointment: Appointment, cancelUrl: string): string {
	const parts: string[] = [];
	if (appointment.attendee_notes) parts.push(appointment.attendee_notes);
	parts.push(`Reschedule or cancel: ${cancelUrl}`);
	return parts.join('\n\n');
}
