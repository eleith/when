import { generateIcsCalendar, type IcsCalendar, type IcsEvent } from 'ts-ics';
import { describeAppointment } from './description.js';
import { icsParameter, icsValue } from './text.js';
import { guestContact } from './guest.js';
import { systemClock, type Clock } from './clock.js';
import { originId, type Appointment, type AppointmentStatus } from '@when/db';

export type IcsMethod = 'REQUEST' | 'CANCEL';

export interface IcsInput {
	appointment: Appointment;
	eventTypeName: string;
	hostName: string;
	hostEmail: string;
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
	const { appointment, eventTypeName, hostName, hostEmail, cancelUrl, method } = input;
	const clock = input.clock ?? systemClock;
	const guest = guestContact(appointment);

	const event: IcsEvent = {
		uid: originId(appointment),
		sequence: appointment.ics_sequence,
		summary: icsValue(eventTypeName),
		start: { date: new Date(appointment.start_time), type: 'DATE-TIME' },
		end: { date: new Date(appointment.end_time), type: 'DATE-TIME' },
		stamp: { date: clock.now(), type: 'DATE-TIME' },
		description: icsValue(describeAppointment(appointment, cancelUrl)),
		location: appointment.location ? icsValue(appointment.location) : undefined,
		organizer: icsPerson(hostName, hostEmail),
		// The guest booked, so they've effectively accepted; mark it so calendar
		// clients don't prompt them to RSVP to the noreply organizer.
		attendees: guest
			? [{ ...icsPerson(guest.name, guest.email), partstat: 'ACCEPTED', rsvp: false }]
			: undefined,
		status: eventStatus(method, appointment.status),
		nonStandard: appointment.video_chat
			? { conference: icsValue(appointment.video_chat) }
			: undefined
	};

	const calendar: IcsCalendar = {
		prodId: '-//When//EN',
		version: '2.0',
		events: [event]
	};
	if (method) calendar.method = method;

	const generated = generateIcsCalendar(calendar, {
		nonStandard: {
			conference: {
				name: 'CONFERENCE' as 'X-CONFERENCE',
				generate: (val) => ({ value: val as string, options: { VALUE: 'URI' } })
			}
		}
	});

	return withClientScheduleAgent(generated);
}

/**
 * Injects RFC 6638 § 3.2.4 `SCHEDULE-AGENT=CLIENT` into ATTENDEE properties.
 * This instructs CalDAV servers (e.g. Nextcloud, SabreDAV, Fastmail, Apple Calendar)
 * that the client application handles scheduling and to suppress server-sent emails.
 */
function withClientScheduleAgent(ics: string): string {
	return ics.replaceAll('ATTENDEE;', 'ATTENDEE;SCHEDULE-AGENT=CLIENT;');
}

function icsPerson(name: string, email: string): { name: string; email: string } {
	return { name: icsParameter(name), email };
}

function eventStatus(
	method: IcsMethod | undefined,
	appointmentStatus: AppointmentStatus
): 'CANCELLED' | 'TENTATIVE' | 'CONFIRMED' {
	if (method === 'CANCEL') return 'CANCELLED';
	if (appointmentStatus === 'pending') return 'TENTATIVE';
	return 'CONFIRMED';
}
