import type {
	Provider,
	CalDavProvider,
	GoogleProvider,
	ResolvedCalendar,
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
	providers: WhenConfiguration['providers'],
	db: ReturnType<typeof openDb>
): Promise<Record<string, ConnectedProvider>> {
	const entries = await Promise.all(
		Object.entries(providers).map(
			async ([name, provider]) =>
				[name, connectProvider(provider, await getProviderRefreshToken(db, name))] as const
		)
	);
	return Object.fromEntries(entries);
}

function getCalendarAdapter(
	resolved: ResolvedCalendar,
	services?: Record<string, ConnectedProvider>
): CalendarAdapter {
	const connected = services?.[resolved.providerName];
	if (resolved.type === 'google') {
		return new GoogleAdapter(
			resolved.name,
			resolved.calendar,
			connected as ConnectedGoogleProvider | undefined
		);
	}
	return new CalDavAdapter(
		resolved.name,
		resolved.calendar,
		connected as CalDavProvider | undefined
	);
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
