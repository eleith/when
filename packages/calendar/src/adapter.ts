import type {
	Calendar,
	CalDavCalendar,
	GoogleCalendar,
	Provider,
	CalDavProvider,
	GoogleProvider,
	WhenConfiguration
} from '@when/config';
import { getProviderRefreshToken, type Appointment, type openDb } from '@when/db';
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

// Unlike the config's GoogleProvider, the refresh token is stored outside when.yaml and
// is null until the service is connected.
type ConnectedGoogleProvider = Omit<GoogleProvider, 'refresh_token'> & {
	refresh_token: string | null;
};
type ConnectedProvider = Exclude<Provider, GoogleProvider> | ConnectedGoogleProvider;

// Only google carries a stored credential; every other service is already complete in
// when.yaml. Callers hand over whatever token they hold and let this decide.
function connectProvider(service: Provider, refreshToken: string | null): ConnectedProvider {
	return service.type === 'google' ? { ...service, refresh_token: refreshToken } : service;
}

// Every configured service joined with whatever credential the store holds for it.
async function connectProviders(
	services: Provider[],
	db: ReturnType<typeof openDb>
): Promise<ConnectedProvider[]> {
	return Promise.all(
		services.map(async (service) =>
			connectProvider(service, await getProviderRefreshToken(db, service.name))
		)
	);
}

function getCalendarAdapter(cal: Calendar, services?: ConnectedProvider[]): CalendarAdapter {
	const type = cal.type;
	if (type === 'caldav') {
		const service = services?.find((s) => s.name === (cal as CalDavCalendar).provider);
		return new CalDavAdapter(cal as CalDavCalendar, service as CalDavProvider | undefined);
	}
	if (type === 'google') {
		const service = services?.find((s) => s.name === (cal as GoogleCalendar).provider);
		return new GoogleAdapter(cal as GoogleCalendar, service as ConnectedGoogleProvider | undefined);
	}
	throw new Error(`Unsupported calendar type: ${type}`);
}

export type {
	PushOptions,
	PushResult,
	DeleteResult,
	CalendarAdapter,
	ConnectedProvider,
	ConnectedGoogleProvider
};

export { getCalendarAdapter, connectProvider, connectProviders };
