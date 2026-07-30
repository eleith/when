import { define } from 'gunshi';
import { getGoogleAccessToken, listGoogleCalendars, discoverCalDavCalendars } from '@when/calendar';
import type { Service, GoogleService, CalDavService, NextcloudService } from '@when/config';
import { requireService, resolveServiceEnv, servicesAndName } from './shared.ts';
import { pass, fail } from '../../utils/report.ts';

export const calendarsCommand = define({
	name: 'calendars',
	description: 'list the calendars a service exposes',
	args: {
		name: { type: 'positional', required: false, description: 'the service to inspect' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' },
		refreshToken: {
			type: 'string',
			description: 'refresh token for a google service (the stored one lives in the database)'
		}
	},
	toKebab: true,
	async run(ctx) {
		const resolved = await servicesAndName(ctx.values?.name, ctx.values?.config, 'calendars');
		if (resolved)
			await runServiceCalendars(resolved.services, resolved.name, ctx.values?.refreshToken);
	}
});

export async function runServiceCalendars(
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
		await listGoogle(resolved, refreshToken);
	} else {
		await listCalDav(resolved);
	}
}

async function listGoogle(service: GoogleService, refreshToken: string): Promise<void> {
	try {
		const token = await getGoogleAccessToken({
			client_id: service.client_id,
			client_secret: service.client_secret,
			refresh_token: refreshToken,
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
