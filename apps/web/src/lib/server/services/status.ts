import type { Kysely } from 'kysely';
import type { WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import { getGoogleAccessToken, verifyCalDavService } from '@when/calendar';
import {
	getServiceRefreshToken,
	listServiceConnections,
	listCalendarSyncStatus,
	listOutOfSyncAppointments
} from '@when/db';
import { evaluateCalendarStatuses } from '$lib/server/calendar/health';
import { googleRedirectUri } from './google-connect';

export interface ServiceView {
	name: string;
	type: 'google' | 'caldav' | 'nextcloud';
	connectedAt: string | null;
	calendars: string[];
	endpoint: { label: string; url: string };
	health: 'good' | 'bad' | 'unknown';
	reason: string | null;
	lastSyncedAt: string | null;
}

export type ProbeResult = { ok: true; message: string } | { ok: false; message: string };

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

	const connected = new Map(connections.map((c) => [c.serviceName, c]));
	const statuses = new Map(
		evaluateCalendarStatuses(syncStatus, outOfSync, config, Temporal.Now.instant()).map((s) => [
			s.id,
			s
		])
	);
	const lastSynced = new Map(syncStatus.map((s) => [s.calendar_id, s.last_successful_refresh_at]));

	return (config.services ?? []).map((service) => {
		const calendars = config.calendars
			.filter((cal) => cal.service === service.name)
			.map((cal) => cal.name);

		const failing = calendars.map((id) => statuses.get(id)).find((s) => s?.health === 'bad');
		const anyGood = calendars.some((id) => statuses.get(id)?.health === 'good');

		return {
			name: service.name,
			type: service.type,
			connectedAt: connected.get(service.name)?.connectedAt ?? null,
			calendars,
			endpoint:
				service.type === 'google'
					? { label: 'Redirect URI', url: googleRedirectUri(config.url.app) }
					: { label: 'Server URL', url: service.url },
			health: failing ? 'bad' : anyGood ? 'good' : 'unknown',
			reason: failing?.reason ?? null,
			lastSyncedAt: latest(calendars.map((id) => lastSynced.get(id) ?? null))
		};
	});
}

function latest(times: (string | null)[]): string | null {
	return (
		times
			.filter((t): t is string => t !== null)
			.sort()
			.at(-1) ?? null
	);
}

export async function probeService(
	config: WhenConfiguration,
	db: Kysely<Database>,
	name: string
): Promise<ProbeResult> {
	const service = config.services?.find((s) => s.name === name);
	if (!service) return { ok: false, message: `No service named "${name}".` };

	try {
		if (service.type === 'google') {
			const refreshToken = await getServiceRefreshToken(db, name);
			if (!refreshToken) return { ok: false, message: 'Not connected yet.' };
			await getGoogleAccessToken({
				client_id: service.client_id,
				client_secret: service.client_secret,
				refresh_token: refreshToken,
				google_calendar_id: ''
			});
		} else {
			await verifyCalDavService(service);
		}
		return { ok: true, message: 'Authenticated.' };
	} catch (err) {
		return { ok: false, message: err instanceof Error ? err.message : String(err) };
	}
}
