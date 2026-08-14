import type { ResolvedCalendar, WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import type { ExpandWindow } from './expand.js';
import { CalDavAdapter } from './adapters/caldav.js';
import { GoogleAdapter } from './adapters/google.js';
import type { BusyEvent } from './types.js';

interface PushOptions {
	cancelUrl: string;
	attachVideoChat?: boolean;
}

interface PushResult {
	ok: boolean;
	reason?: string;
	externalEventId?: string;
	externalCalendarId?: string;
	videoChatUrl?: string;
}

interface DeleteResult {
	ok: boolean;
	reason?: string;
}

interface CalendarAdapter {
	fetchBusy(window: ExpandWindow): Promise<BusyEvent[]>;
	pushAppointment(
		cfg: WhenConfiguration,
		appointment: Appointment,
		eventTypeName: string,
		opts: PushOptions
	): Promise<PushResult>;
	deleteAppointment(externalEventId: string): Promise<DeleteResult>;
}

function getCalendarAdapter(resolved: ResolvedCalendar): CalendarAdapter {
	return resolved.type === 'google'
		? new GoogleAdapter(resolved.name, resolved.calendar, resolved.provider)
		: new CalDavAdapter(resolved.name, resolved.calendar, resolved.provider);
}

export type { PushOptions, PushResult, DeleteResult, CalendarAdapter };

export { getCalendarAdapter };
