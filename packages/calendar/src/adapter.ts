import type {
	Calendar,
	CalDavCalendar,
	GoogleCalendar,
	Service,
	CalDavService,
	GoogleService,
	WhenConfiguration
} from '@when/config';
import { getServiceRefreshToken, type Appointment, type openDb } from '@when/db';
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

// Unlike the config's GoogleService, the refresh token is stored outside when.yaml and
// is null until the service is connected.
type ConnectedGoogleService = Omit<GoogleService, 'refresh_token'> & {
	refresh_token: string | null;
};
type ConnectedService = Exclude<Service, GoogleService> | ConnectedGoogleService;

// Only google carries a stored credential; every other service is already complete in
// when.yaml. Callers hand over whatever token they hold and let this decide.
function connectService(service: Service, refreshToken: string | null): ConnectedService {
	return service.type === 'google' ? { ...service, refresh_token: refreshToken } : service;
}

// Every configured service joined with whatever credential the store holds for it.
async function connectServices(
	services: Service[],
	db: ReturnType<typeof openDb>
): Promise<ConnectedService[]> {
	return Promise.all(
		services.map(async (service) =>
			connectService(service, await getServiceRefreshToken(db, service.name))
		)
	);
}

function getCalendarAdapter(cal: Calendar, services?: ConnectedService[]): CalendarAdapter {
	const type = cal.type;
	if (type === 'caldav') {
		const service = services?.find((s) => s.name === (cal as CalDavCalendar).service);
		return new CalDavAdapter(cal as CalDavCalendar, service as CalDavService | undefined);
	}
	if (type === 'google') {
		const service = services?.find((s) => s.name === (cal as GoogleCalendar).service);
		return new GoogleAdapter(cal as GoogleCalendar, service as ConnectedGoogleService | undefined);
	}
	throw new Error(`Unsupported calendar type: ${type}`);
}

export type {
	PushOptions,
	PushResult,
	DeleteResult,
	CalendarAdapter,
	ConnectedService,
	ConnectedGoogleService
};

export { getCalendarAdapter, connectService, connectServices };
