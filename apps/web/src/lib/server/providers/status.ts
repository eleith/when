import type { Kysely } from 'kysely';
import type { Provider, WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import { connectProvider, getProviderAdapter, type ProviderCalendar } from '@when/calendar';
import { listProviderConnections, listServiceStatus } from '@when/db';
import { getOpenWorkflow, listProviderCalendars, testProvider } from '@when/jobs';
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
	const [connections, providerStatus] = await Promise.all([
		listProviderConnections(db),
		listServiceStatus(db, 'provider')
	]);

	const connected = new Map(connections.map((c) => [c.providerName, c]));
	const observedByName = new Map(providerStatus.map((s) => [s.name, s]));

	return config.providers.map((provider) => {
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
			observed: observedFrom(observedByName.get(provider.name))
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

export async function probeProvider(config: WhenConfiguration, name: string): Promise<ProbeResult> {
	const reachable = await workerReachable(config.url.worker);
	if (!reachable) {
		return { ok: false, message: 'Worker not reachable.' };
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
	const reachable = await workerReachable(config.url.worker);
	if (!reachable) {
		return { ok: false, message: 'Worker not reachable.' };
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
