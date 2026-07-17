import { getGoogleAccessToken, listGoogleCalendars, discoverCalDavCalendars } from '@when/calendar';
import type { Service, GoogleService, CalDavService, NextcloudService } from '@when/config';
import { requireService, resolveServiceEnv } from './shared.ts';
import { pass, fail } from '../../utils/report.ts';

export async function runServiceCalendars(services: Service[], name: string): Promise<void> {
	const service = requireService(services, name);
	if (!service) return;

	const resolved = resolveServiceEnv(service);
	if (!resolved) return;

	if (resolved.type === 'google') {
		await listGoogle(resolved);
	} else {
		await listCalDav(resolved);
	}
}

async function listGoogle(service: GoogleService): Promise<void> {
	try {
		const token = await getGoogleAccessToken({
			client_id: service.client_id,
			client_secret: service.client_secret,
			refresh_token: service.refresh_token,
			google_calendar_id: ''
		});
		const calendars = await listGoogleCalendars(token);
		if (calendars.length === 0) {
			pass(`${service.name} (google) — no calendars found`);
			return;
		}
		pass(`${service.name} (google) — ${calendars.length} calendar(s):`);
		for (const c of calendars) {
			console.log(`  ${c.id}${c.primary ? '  (primary)' : ''}  ${c.summary}`);
		}
	} catch (err) {
		fail(`${service.name} (google) — ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function listCalDav(service: CalDavService | NextcloudService): Promise<void> {
	try {
		const calendars = await discoverCalDavCalendars(service);
		if (calendars.length === 0) {
			pass(`${service.name} (${service.type}) — no calendars found`);
			return;
		}
		pass(`${service.name} (${service.type}) — ${calendars.length} calendar(s):`);
		for (const c of calendars) {
			console.log(`  ${c.path}  ${c.displayName}`);
		}
	} catch (err) {
		fail(`${service.name} (${service.type}) — ${err instanceof Error ? err.message : String(err)}`);
	}
}
