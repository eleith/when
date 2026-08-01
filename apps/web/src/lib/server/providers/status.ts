import type { Kysely } from 'kysely';
import type { Provider, WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import {
	connectProvider,
	getProviderAdapter,
	type ProviderAdapter,
	type ProviderCalendar
} from '@when/calendar';
import {
	getProviderRefreshToken,
	listProviderConnections,
	listServiceStatus,
	listOutOfSyncAppointments,
	recordServiceOutcome
} from '@when/db';
import { evaluateCalendarStatuses, type ComputedCalendarStatus } from '$lib/server/calendar/health';
import { observedFrom, type ObservedView } from '$lib/server/observed';
import { googleRedirectUri } from './google-connect';

export interface ProviderView {
	name: string;
	type: 'google' | 'caldav' | 'nextcloud';
	connectedAt: string | null;
	calendars: string[];
	endpoint: { label: string; url: string };
	usesOAuth: boolean;
	observed: ObservedView;
	sync: {
		health: 'good' | 'bad' | 'unknown';
		reason: string | null;
		lastSyncedAt: string | null;
	};
}

export type ProbeResult = { ok: true; message: string } | { ok: false; message: string };

export type DiscoveryResult =
	| { ok: true; field: string; calendars: ProviderCalendar[] }
	| { ok: false; message: string };

// Nothing here reaches the network: every verdict is something the worker or a manual test
// already observed.
export async function listProviders(
	config: WhenConfiguration,
	db: Kysely<Database>
): Promise<ProviderView[]> {
	const [connections, calendarStatus, providerStatus, outOfSync] = await Promise.all([
		listProviderConnections(db),
		listServiceStatus(db, 'calendar'),
		listServiceStatus(db, 'provider'),
		listOutOfSyncAppointments(db)
	]);

	const computed = evaluateCalendarStatuses(
		calendarStatus,
		outOfSync,
		config,
		Temporal.Now.instant()
	);
	const connected = new Map(connections.map((c) => [c.providerName, c]));
	const statuses = new Map(computed.map((s) => [s.id, s]));
	const observedByName = new Map(providerStatus.map((s) => [s.name, s]));
	const lastSynced = new Map(calendarStatus.map((s) => [s.name, s.last_ok_at]));

	return (config.providers ?? []).map((provider) => {
		const { usesOAuth } = getProviderAdapter(connectProvider(provider, null));
		const calendars = config.calendars
			.filter((cal) => cal.provider === provider.name)
			.map((cal) => cal.name);

		return {
			name: provider.name,
			type: provider.type,
			connectedAt: connected.get(provider.name)?.connectedAt ?? null,
			calendars,
			endpoint: endpointOf(provider, usesOAuth, config.url.app),
			usesOAuth,
			observed: observedFrom(observedByName.get(provider.name)),
			sync: {
				...syncStateOf(calendars, statuses),
				lastSyncedAt: latest(calendars.map((id) => lastSynced.get(id) ?? null))
			}
		};
	});
}

// The redirect URI is ours, not the provider's, so it stays a web concern.
function endpointOf(
	provider: Provider,
	usesOAuth: boolean,
	appUrl: string
): ProviderView['endpoint'] {
	if (!usesOAuth && 'url' in provider) return { label: 'Server URL', url: provider.url };
	return { label: 'Redirect URI', url: googleRedirectUri(appUrl) };
}

function syncStateOf(
	calendars: string[],
	statuses: Map<string, ComputedCalendarStatus>
): Pick<ProviderView['sync'], 'health' | 'reason'> {
	const failing = calendars.map((id) => statuses.get(id)).find((s) => s?.health === 'bad');
	if (failing) return { health: 'bad', reason: failing.reason };

	const synced = calendars.some((id) => statuses.get(id)?.health === 'good');
	return { health: synced ? 'good' : 'unknown', reason: null };
}

function latest(times: (string | null)[]): string | null {
	const known = times.filter((t): t is string => t !== null);
	return known.sort().at(-1) ?? null;
}

export async function probeProvider(
	config: WhenConfiguration,
	db: Kysely<Database>,
	name: string
): Promise<ProbeResult> {
	const at = Temporal.Now.instant().toString();
	try {
		const adapter = await connectedAdapter(config, db, name);
		await adapter.verify();
		await recordServiceOutcome(db, { kind: 'provider', name }, { at, via: 'test' });
		return { ok: true, message: 'Authenticated.' };
	} catch (err) {
		const message = reason(err);
		if (config.providers?.some((p) => p.name === name)) {
			await recordServiceOutcome(
				db,
				{ kind: 'provider', name },
				{ at, via: 'test', error: message }
			);
		}
		return { ok: false, message };
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

// Joins the two halves of a provider — config and stored credential — into the adapter
// that knows how to talk to it.
async function connectedAdapter(
	config: WhenConfiguration,
	db: Kysely<Database>,
	name: string
): Promise<ProviderAdapter> {
	const provider = config.providers?.find((s) => s.name === name);
	if (!provider) throw new Error(`No provider named "${name}".`);

	const refreshToken = await getProviderRefreshToken(db, name);
	return getProviderAdapter(connectProvider(provider, refreshToken));
}
