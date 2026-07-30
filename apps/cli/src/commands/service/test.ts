import { define } from 'gunshi';
import { getGoogleAccessToken, verifyCalDavService } from '@when/calendar';
import type { Service, GoogleService, CalDavService, NextcloudService } from '@when/config';
import { requireService, resolveServiceEnv, servicesAndName } from './shared.ts';
import { pass, fail } from '../../utils/report.ts';

export const testCommand = define({
	name: 'test',
	description: 'authenticate a service (Google token refresh / CalDAV PROPFIND)',
	args: {
		name: { type: 'positional', required: false, description: 'the service to test' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' },
		refreshToken: {
			type: 'string',
			description: 'refresh token for a google service (the stored one lives in the database)'
		}
	},
	toKebab: true,
	async run(ctx) {
		const resolved = await servicesAndName(ctx.values?.name, ctx.values?.config, 'test');
		if (resolved) await runServiceTest(resolved.services, resolved.name, ctx.values?.refreshToken);
	}
});

export async function runServiceTest(
	services: Service[],
	name: string,
	refreshToken?: string
): Promise<void> {
	const service = requireService(services, name);
	if (!service) return;

	const resolved = resolveServiceEnv(service);
	if (!resolved) return;

	if (resolved.type === 'google') {
		if (!refreshToken) {
			fail(`${name} (google) — pass --refresh-token; the stored one is not readable from here`);
			return;
		}
		await testGoogle(name, resolved, refreshToken);
	} else {
		await testCalDav(name, resolved);
	}
}

async function testGoogle(
	name: string,
	service: GoogleService,
	refreshToken: string
): Promise<void> {
	try {
		await getGoogleAccessToken({
			client_id: service.client_id,
			client_secret: service.client_secret,
			refresh_token: refreshToken,
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
