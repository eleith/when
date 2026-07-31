import { define } from 'gunshi';
import { connectService, getServiceAdapter } from '@when/calendar';
import type { Service } from '@when/config';
import { requireService, servicesAndName } from './shared.ts';
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

	const adapter = getServiceAdapter(connectService(service, refreshToken ?? null));
	if (adapter.usesOAuth && !refreshToken) {
		fail(`${name} (${service.type}) — pass --refresh-token; the stored one lives in the database`);
		return;
	}

	try {
		const calendars = await adapter.listCalendars();
		if (calendars.length === 0) {
			pass(`${name} (${service.type}) — no calendars found`);
			return;
		}
		pass(`${name} (${service.type}) — ${calendars.length} calendar(s):`);
		for (const calendar of calendars) {
			console.log(`  ${adapter.calendarIdField}: ${calendar.id}  ${calendar.name}`);
		}
	} catch (err) {
		fail(`${name} (${service.type}) — ${err instanceof Error ? err.message : String(err)}`);
	}
}
