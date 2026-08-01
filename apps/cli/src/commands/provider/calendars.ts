import { define } from 'gunshi';
import { connectProvider, getProviderAdapter } from '@when/calendar';
import type { Provider } from '@when/config';
import { requireProvider, providersAndName } from './shared.ts';
import { pass, fail } from '../../utils/report.ts';

export const calendarsCommand = define({
	name: 'calendars',
	description: 'list the calendars a provider exposes',
	args: {
		name: { type: 'positional', required: false, description: 'the provider to inspect' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' },
		refreshToken: {
			type: 'string',
			description: 'refresh token for a google provider (the stored one lives in the database)'
		}
	},
	toKebab: true,
	async run(ctx) {
		const resolved = await providersAndName(ctx.values?.name, ctx.values?.config, 'calendars');
		if (resolved)
			await runProviderCalendars(resolved.providers, resolved.name, ctx.values?.refreshToken);
	}
});

export async function runProviderCalendars(
	providers: Provider[],
	name: string,
	refreshToken?: string
): Promise<void> {
	const provider = requireProvider(providers, name);
	if (!provider) return;

	const adapter = getProviderAdapter(connectProvider(provider, refreshToken ?? null));
	if (adapter.usesOAuth && !refreshToken) {
		fail(`${name} (${provider.type}) — pass --refresh-token; the stored one lives in the database`);
		return;
	}

	try {
		const calendars = await adapter.listCalendars();
		if (calendars.length === 0) {
			pass(`${name} (${provider.type}) — no calendars found`);
			return;
		}
		pass(`${name} (${provider.type}) — ${calendars.length} calendar(s):`);
		for (const calendar of calendars) {
			console.log(`  ${adapter.calendarIdField}: ${calendar.id}  ${calendar.name}`);
		}
	} catch (err) {
		fail(`${name} (${provider.type}) — ${err instanceof Error ? err.message : String(err)}`);
	}
}
