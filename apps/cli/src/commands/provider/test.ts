import { define } from 'gunshi';
import { connectProvider, getProviderAdapter } from '@when/calendar';
import type { Provider } from '@when/config';
import { requireProvider, providersAndName } from './shared.ts';
import { pass, fail } from '../../utils/report.ts';

export const testCommand = define({
	name: 'test',
	description: 'authenticate a provider (Google token refresh / CalDAV PROPFIND)',
	args: {
		name: { type: 'positional', required: false, description: 'the provider to test' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' },
		refreshToken: {
			type: 'string',
			description: 'refresh token for a google provider (the stored one lives in the database)'
		}
	},
	toKebab: true,
	async run(ctx) {
		const resolved = await providersAndName(ctx.values?.name, ctx.values?.config, 'test');
		if (resolved)
			await runProviderTest(resolved.providers, resolved.name, ctx.values?.refreshToken);
	}
});

export async function runProviderTest(
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
		await adapter.verify();
		pass(`${name} (${provider.type}) — authenticated`);
	} catch (err) {
		fail(`${name} (${provider.type}) — ${err instanceof Error ? err.message : String(err)}`);
	}
}
