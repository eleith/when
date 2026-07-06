import type {
	Calendar,
	CalDavCalendar,
	GoogleCalendar,
	Service,
	CalDavService,
	GoogleService,
	WhenConfiguration
} from '@when/config';
import type { Appointment } from '@when/db';
import type { ExpandWindow } from './expand.js';
import { CalDavAdapter } from './adapters/caldav.js';
import { GoogleAdapter } from './adapters/google.js';
import type { BusyEvent } from './types.js';

interface PushOptions {
	cancelUrl: string;
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

function getCalendarAdapter(cal: Calendar, services?: Service[]): CalendarAdapter {
	const type = cal.type;
	if (type === 'caldav') {
		const service = services?.find((s) => s.id === (cal as CalDavCalendar).service_id);
		return new CalDavAdapter(cal as CalDavCalendar, service as CalDavService | undefined);
	}
	if (type === 'google') {
		const service = services?.find((s) => s.id === (cal as GoogleCalendar).service_id);
		return new GoogleAdapter(cal as GoogleCalendar, service as GoogleService | undefined);
	}
	throw new Error(`Unsupported calendar type: ${type}`);
}

export type {
	PushOptions,
	PushResult,
	DeleteResult,
	CalendarAdapter
};

export { getCalendarAdapter };
