import { getGoogleAccessToken } from '@when/calendar';
import {
	interpolate,
	MissingEnvVarsError,
	type Service,
	type GoogleService,
	type CalDavService,
	type NextcloudService
} from '@when/config';
import { probeCalDavAuth } from '../../services/caldav.ts';
import { pass, fail } from '../../utils/report.ts';

export async function runServiceTest(services: Service[], name: string): Promise<void> {
	const service = services.find((s) => s.name === name);
	if (!service) {
		fail(`no service named "${name}"`);
		return;
	}

	const resolved = resolveEnv(service);
	if (!resolved) return;

	if (resolved.type === 'google') {
		await testGoogle(name, resolved);
	} else {
		await testCalDav(name, resolved);
	}
}

function resolveEnv(service: Service): Service | null {
	try {
		return interpolate(service);
	} catch (err) {
		if (err instanceof MissingEnvVarsError) {
			fail(`${service.name} (${service.type}) — unset env var(s): ${err.missing.join(', ')}`);
			return null;
		}
		throw err;
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
	const result = await probeCalDavAuth(service.url, service.username, service.password);
	if (result.ok) {
		pass(`${name} (${service.type}) — authenticated`);
	} else {
		fail(`${name} (${service.type}) — ${result.reason}`);
	}
}
