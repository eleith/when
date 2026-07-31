import type { CalDavService, NextcloudService } from '@when/config';
import type { ConnectedGoogleService, ConnectedService } from './adapter.js';
import { getGoogleAccessToken, listGoogleCalendars } from './adapters/google.js';
import { verifyCalDavService, discoverCalDavCalendars } from './adapters/caldav.js';

/** A calendar a service exposes, keyed by the value its config field wants. */
export interface ServiceCalendar {
	id: string;
	name: string;
	primary: boolean;
}

/**
 * Service-level operations, the sibling of CalendarAdapter: that one acts on a configured
 * calendar, this one on the service behind it — before any calendar exists to name.
 */
export interface ServiceAdapter {
	/** The when.yaml calendar field that `ServiceCalendar.id` belongs in. */
	readonly calendarIdField: string;
	/** Whether the credential is minted by an OAuth flow rather than typed into config. */
	readonly usesOAuth: boolean;
	verify(): Promise<void>;
	listCalendars(): Promise<ServiceCalendar[]>;
}

class GoogleServiceAdapter implements ServiceAdapter {
	readonly calendarIdField = 'google_calendar_id';
	readonly usesOAuth = true;

	private service: ConnectedGoogleService;

	constructor(service: ConnectedGoogleService) {
		this.service = service;
	}

	async verify(): Promise<void> {
		await this.accessToken();
	}

	async listCalendars(): Promise<ServiceCalendar[]> {
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
		if (!this.service.refresh_token) {
			throw new Error(`Google service "${this.service.name}" is not connected`);
		}
		return getGoogleAccessToken({
			client_id: this.service.client_id,
			client_secret: this.service.client_secret,
			refresh_token: this.service.refresh_token,
			google_calendar_id: ''
		});
	}
}

class CalDavServiceAdapter implements ServiceAdapter {
	readonly calendarIdField = 'path';
	readonly usesOAuth = false;

	private service: CalDavService | NextcloudService;

	constructor(service: CalDavService | NextcloudService) {
		this.service = service;
	}

	async verify(): Promise<void> {
		await verifyCalDavService(this.service);
	}

	async listCalendars(): Promise<ServiceCalendar[]> {
		const found = await discoverCalDavCalendars(this.service);
		return found.map((c) => ({ id: c.path, name: c.displayName, primary: false }));
	}
}

export function getServiceAdapter(service: ConnectedService): ServiceAdapter {
	return service.type === 'google'
		? new GoogleServiceAdapter(service)
		: new CalDavServiceAdapter(service);
}
