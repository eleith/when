import { getGoogleAccessToken, verifyCalDavService } from '@when/calendar';
import type { Service, GoogleService, CalDavService, NextcloudService } from '@when/config';
import { requireService, resolveServiceEnv } from './shared.ts';
import { pass, fail } from '../../utils/report.ts';

export async function runServiceTest(services: Service[], name: string): Promise<void> {
	const service = requireService(services, name);
	if (!service) return;

	const resolved = resolveServiceEnv(service);
	if (!resolved) return;

	if (resolved.type === 'google') {
		await testGoogle(name, resolved);
	} else {
		await testCalDav(name, resolved);
	}
}

async function testGoogle(name: string, service: GoogleService): Promise<void> {
	try {
		await getGoogleAccessToken({
			client_id: service.client_id,
			client_secret: service.client_secret,
			refresh_token: service.refresh_token,
			google_calendar_id: ''
		});
		pass(`${name} (google) — authenticated`);
	} catch (err) {
		fail(`${name} (google) — ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function testCalDav(name: string, service: CalDavService | NextcloudService): Promise<void> {
	try {
		await verifyCalDavService(service);
		pass(`${name} (${service.type}) — authenticated`);
	} catch (err) {
		fail(`${name} (${service.type}) — ${err instanceof Error ? err.message : String(err)}`);
	}
}
