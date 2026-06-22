import { generateIcsCalendar, type IcsCalendar, type IcsEvent } from 'ts-ics';
import { guestContact, describeAppointment } from '@when/calendar';
import { originId, type Appointment, type AppointmentStatus } from '@when/db';
import { systemClock, type Clock } from './clock.js';
import { eventTypeName } from './format.js';
import type { Attachment } from './recipients.js';
import type { AppointmentEmailInput } from './types.js';

export type IcsMethod = 'REQUEST' | 'CANCEL';

export interface IcsInput {
	appointment: Appointment;
	eventTypeName: string;
	hostName: string;
	hostEmail: string;
	/** Public URL the booker can use to cancel or reschedule. */
	cancelUrl: string;
	/**
	 * Set for scheduling messages (iMIP email attachments): emits a calendar-level
	 * `METHOD` line and forces the corresponding event STATUS.
	 */
	method?: IcsMethod;
	clock?: Clock;
}

export function buildIcs(input: IcsInput): string {
	const { appointment, eventTypeName: name, hostName, hostEmail, cancelUrl, method } = input;
	const clock = input.clock ?? systemClock;
	const guest = guestContact(appointment);

	const event: IcsEvent = {
		uid: originId(appointment),
		sequence: appointment.ics_sequence,
		summary: name,
		start: { date: new Date(appointment.start_time), type: 'DATE-TIME' },
		end: { date: new Date(appointment.end_time), type: 'DATE-TIME' },
		stamp: { date: clock.now(), type: 'DATE-TIME' },
		description: describeAppointment(appointment, cancelUrl),
		location: appointment.location ?? undefined,
		organizer: { name: hostName, email: hostEmail },
		attendees: guest ? [guest] : undefined,
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

function icsAttachment(input: IcsInput): Attachment {
	return {
		filename: 'invite.ics',
		content: buildIcs(input),
		contentType: 'text/calendar; charset=utf-8'
	};
}

/** A `METHOD:REQUEST` invite for a confirmed appointment (guest attachment). */
export function requestIcs(i: AppointmentEmailInput, bookedUrl: string): Attachment {
	return icsAttachment({
		appointment: { ...i.appointment, status: 'confirmed' },
		eventTypeName: eventTypeName(i.eventType, i.appointment),
		hostName: i.cfg.user.name,
		hostEmail: i.cfg.user.email,
		cancelUrl: bookedUrl,
		method: 'REQUEST'
	});
}

/** A `METHOD:CANCEL` invite for a cancelled appointment (guest attachment). */
export function cancelIcs(i: AppointmentEmailInput, bookedUrl: string): Attachment {
	return icsAttachment({
		appointment: i.appointment,
		eventTypeName: eventTypeName(i.eventType, i.appointment),
		hostName: i.cfg.user.name,
		hostEmail: i.cfg.user.email,
		cancelUrl: bookedUrl,
		method: 'CANCEL'
	});
}
