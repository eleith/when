import type { Calendar, CalDavCalendar, GoogleCalendar, WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import type { ExpandWindow } from './expand.js';
import type { BusyEvent } from './types.js';
import { CalDavAdapter } from './adapters/caldav.js';
import { GoogleAdapter } from './adapters/google.js';

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface PushOptions {
	cancelUrl: string;
	fetchImpl?: FetchFn;
}

export type PushResult =
	| { ok: true; externalEventId: string; externalCalendarId: string }
	| { ok: false; reason: string };

export type DeleteResult = { ok: true } | { ok: false; reason: string };

export interface CalendarAdapter {
	fetchBusy(window: ExpandWindow, opts?: { fetchImpl?: FetchFn }): Promise<BusyEvent[]>;
	pushAppointment(
		cfg: WhenConfiguration,
		appointment: Appointment,
		eventTypeName: string,
		opts: PushOptions
	): Promise<PushResult>;
	deleteAppointment(externalEventId: string, opts?: { fetchImpl?: FetchFn }): Promise<DeleteResult>;
}

export function getCalendarAdapter(cal: Calendar): CalendarAdapter {
	const type = cal.type;
	if (type === 'caldav') {
		return new CalDavAdapter(cal as CalDavCalendar);
	}
	if (type === 'google') {
		return new GoogleAdapter(cal as GoogleCalendar);
	}
	throw new Error(`Unsupported calendar type: ${type}`);
}
