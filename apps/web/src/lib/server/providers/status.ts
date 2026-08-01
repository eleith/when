import type { Kysely } from 'kysely';
import type { Provider, WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import { connectProvider, getProviderAdapter, type ProviderCalendar } from '@when/calendar';
import { listProviderConnections, listServiceStatus, listOutOfSyncAppointments } from '@when/db';
import { getOpenWorkflow, listProviderCalendars, testProvider } from '@when/jobs';
import { evaluateCalendarStatuses, type ComputedCalendarStatus } from '$lib/server/calendar/health';
import { observedFrom, type ObservedView } from '$lib/server/observed';
import { workerReachable } from '$lib/server/worker';
import { googleRedirectUri } from './google-connect';

const PROBE_TIMEOUT_MS = 30_000;

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

export async function probeProvider(config: WhenConfiguration, name: string): Promise<ProbeResult> {
	if (!(await workerReachable(config.url.worker))) {
		return { ok: false, message: 'The worker is not reachable, so nothing would check it.' };
	}

	try {
		const handle = await getOpenWorkflow().runWorkflow(
			testProvider,
			{ name },
			{ idempotencyKey: crypto.randomUUID() }
		);
		await handle.result({ timeoutMs: PROBE_TIMEOUT_MS });
		return { ok: true, message: 'Authenticated.' };
	} catch (err) {
		return { ok: false, message: reason(err) };
	}
}

export async function discoverCalendars(
	config: WhenConfiguration,
	name: string
): Promise<DiscoveryResult> {
	if (!(await workerReachable(config.url.worker))) {
		return { ok: false, message: 'The worker is not reachable, so nothing would ask it.' };
	}

	try {
		const handle = await getOpenWorkflow().runWorkflow(
			listProviderCalendars,
			{ name },
			{ idempotencyKey: crypto.randomUUID() }
		);
		const { field, calendars } = await handle.result({ timeoutMs: PROBE_TIMEOUT_MS });
		return { ok: true, field, calendars };
	} catch (err) {
		return { ok: false, message: reason(err) };
	}
}

function reason(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
