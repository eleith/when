import type {
	Calendar,
	CalDavCalendar,
	GoogleCalendar,
	WhenConfiguration,
	CalDavService,
	GoogleService
} from '@when/config';
import type { Appointment } from '@when/db';
import type { ExpandWindow } from './expand.js';
import type { BusyEvent } from './types.js';
import { CalDavAdapter } from './adapters/caldav.js';
import { GoogleAdapter } from './adapters/google.js';

interface PushOptions {
	cancelUrl: string;
}

type PushResult =
	| { ok: true; externalEventId: string; externalCalendarId: string; videoChatUrl?: string }
	| { ok: false; reason: string };

type DeleteResult = { ok: true } | { ok: false; reason: string };

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

function getCalendarAdapter(cal: Calendar, config?: WhenConfiguration): CalendarAdapter {
	const type = cal.type;
	if (type === 'caldav') {
		const service = config?.services?.find((s) => s.id === (cal as CalDavCalendar).service_id);
		return new CalDavAdapter(cal as CalDavCalendar, service as CalDavService | undefined);
	}
	if (type === 'google') {
		const service = config?.services?.find((s) => s.id === (cal as GoogleCalendar).service_id);
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
