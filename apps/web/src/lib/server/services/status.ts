import type { Kysely } from 'kysely';
import type { Service, WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import {
	connectService,
	getServiceAdapter,
	type ServiceAdapter,
	type ServiceCalendar
} from '@when/calendar';
import {
	getServiceRefreshToken,
	listServiceConnections,
	listCalendarSyncStatus,
	listOutOfSyncAppointments
} from '@when/db';
import { evaluateCalendarStatuses, type ComputedCalendarStatus } from '$lib/server/calendar/health';
import { googleRedirectUri } from './google-connect';

export interface ServiceView {
	name: string;
	type: 'google' | 'caldav' | 'nextcloud';
	connectedAt: string | null;
	calendars: string[];
	endpoint: { label: string; url: string };
	usesOAuth: boolean;
	health: 'good' | 'bad' | 'unknown';
	reason: string | null;
	lastSyncedAt: string | null;
}

export type ProbeResult = { ok: true; message: string } | { ok: false; message: string };

export type DiscoveryResult =
	| { ok: true; field: string; calendars: ServiceCalendar[] }
	| { ok: false; message: string };

// Cheap: config plus indexed reads. Nothing here reaches the network — the worker already
// proved whether each credential works on its last refresh pass, and that verdict is what
// calendar_sync_status holds.
export async function listServices(
	config: WhenConfiguration,
	db: Kysely<Database>
): Promise<ServiceView[]> {
	const [connections, syncStatus, outOfSync] = await Promise.all([
		listServiceConnections(db),
		listCalendarSyncStatus(db),
		listOutOfSyncAppointments(db)
	]);

	const computed = evaluateCalendarStatuses(syncStatus, outOfSync, config, Temporal.Now.instant());
	const connected = new Map(connections.map((c) => [c.serviceName, c]));
	const statuses = new Map(computed.map((s) => [s.id, s]));
	const lastSynced = new Map(syncStatus.map((s) => [s.calendar_id, s.last_successful_refresh_at]));

	return (config.services ?? []).map((service) => {
		const { usesOAuth } = getServiceAdapter(connectService(service, null));
		const calendars = config.calendars
			.filter((cal) => cal.service === service.name)
			.map((cal) => cal.name);

		return {
			name: service.name,
			type: service.type,
			connectedAt: connected.get(service.name)?.connectedAt ?? null,
			calendars,
			endpoint: endpointOf(service, usesOAuth, config.url.app),
			usesOAuth,
			...syncStateOf(calendars, statuses),
			lastSyncedAt: latest(calendars.map((id) => lastSynced.get(id) ?? null))
		};
	});
}

// The redirect URI is ours, not the provider's, so it stays a web concern.
function endpointOf(service: Service, usesOAuth: boolean, appUrl: string): ServiceView['endpoint'] {
	if (!usesOAuth && 'url' in service) return { label: 'Server URL', url: service.url };
	return { label: 'Redirect URI', url: googleRedirectUri(appUrl) };
}

// A service is only as healthy as the calendars it backs: one failing calendar condemns it,
// and with no verdict at all it stays unknown rather than claiming to work.
function syncStateOf(
	calendars: string[],
	statuses: Map<string, ComputedCalendarStatus>
): Pick<ServiceView, 'health' | 'reason'> {
	const failing = calendars.map((id) => statuses.get(id)).find((s) => s?.health === 'bad');
	if (failing) return { health: 'bad', reason: failing.reason };

	const synced = calendars.some((id) => statuses.get(id)?.health === 'good');
	return { health: synced ? 'good' : 'unknown', reason: null };
}

function latest(times: (string | null)[]): string | null {
	const known = times.filter((t): t is string => t !== null);
	return known.sort().at(-1) ?? null;
}

export async function probeService(
	config: WhenConfiguration,
	db: Kysely<Database>,
	name: string
): Promise<ProbeResult> {
	try {
		const adapter = await connectedAdapter(config, db, name);
		await adapter.verify();
		return { ok: true, message: 'Authenticated.' };
	} catch (err) {
		return { ok: false, message: reason(err) };
	}
}

export async function discoverCalendars(
	config: WhenConfiguration,
	db: Kysely<Database>,
	name: string
): Promise<DiscoveryResult> {
	try {
		const adapter = await connectedAdapter(config, db, name);
		const calendars = await adapter.listCalendars();
		return { ok: true, field: adapter.calendarIdField, calendars };
	} catch (err) {
		return { ok: false, message: reason(err) };
	}
}

function reason(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// Joins the two halves of a service — config and stored credential — into the adapter
// that knows how to talk to it.
async function connectedAdapter(
	config: WhenConfiguration,
	db: Kysely<Database>,
	name: string
): Promise<ServiceAdapter> {
	const service = config.services?.find((s) => s.name === name);
	if (!service) throw new Error(`No service named "${name}".`);

	const refreshToken = await getServiceRefreshToken(db, name);
	return getServiceAdapter(connectService(service, refreshToken));
}
