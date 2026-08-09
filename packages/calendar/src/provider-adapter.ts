import type { CalDavProvider, GoogleProvider, NextcloudProvider, Provider } from '@when/config';
import { getGoogleAccessToken, listGoogleCalendars } from './adapters/google.js';
import { verifyCalDavProvider, discoverCalDavCalendars } from './adapters/caldav.js';

/** A calendar a provider exposes, keyed by the value its config field wants. */
export interface ProviderCalendar {
	id: string;
	name: string;
	primary: boolean;
}

/**
 * Provider-level operations, the sibling of CalendarAdapter: that one acts on a configured
 * calendar, this one on the provider behind it — before any calendar exists to name.
 */
export interface ProviderAdapter {
	/** The when.yaml calendar field that `ProviderCalendar.id` belongs in. */
	readonly calendarIdField: string;
	/** Whether the credential is minted by an OAuth flow rather than typed into config. */
	readonly usesOAuth: boolean;
	verify(): Promise<void>;
	listCalendars(): Promise<ProviderCalendar[]>;
}

class GoogleProviderAdapter implements ProviderAdapter {
	readonly calendarIdField = 'google_calendar_id';
	readonly usesOAuth = true;

	private provider: GoogleProvider;

	constructor(provider: GoogleProvider) {
		this.provider = provider;
	}

	async verify(): Promise<void> {
		await this.accessToken();
	}

	async listCalendars(): Promise<ProviderCalendar[]> {
		const found = await listGoogleCalendars(await this.accessToken());
		// Google names the primary calendar after the account's email and gives it that same
		// id, so both read as noise. `primary` is the documented alias and survives an
		// address change.
		return found.map((c) =>
			c.primary === true
				? { id: 'primary', name: 'Primary calendar', primary: true }
				: { id: c.id, name: c.summary, primary: false }
		);
	}

	private accessToken(): Promise<string> {
		if (!this.provider.refresh_token) {
			throw new Error('Google provider is not connected');
		}
		return getGoogleAccessToken({
			client_id: this.provider.client_id,
			client_secret: this.provider.client_secret,
			refresh_token: this.provider.refresh_token,
			google_calendar_id: ''
		});
	}
}

class CalDavProviderAdapter implements ProviderAdapter {
	readonly calendarIdField = 'path';
	readonly usesOAuth = false;

	private provider: CalDavProvider | NextcloudProvider;

	constructor(provider: CalDavProvider | NextcloudProvider) {
		this.provider = provider;
	}

	async verify(): Promise<void> {
		await verifyCalDavProvider(this.provider);
	}

	async listCalendars(): Promise<ProviderCalendar[]> {
		const found = await discoverCalDavCalendars(this.provider);
		return found.map((c) => ({ id: c.path, name: c.displayName, primary: false }));
	}
}

export function getProviderAdapter(service: Provider): ProviderAdapter {
	return service.type === 'google'
		? new GoogleProviderAdapter(service)
		: new CalDavProviderAdapter(service);
}
