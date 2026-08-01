import { define } from 'gunshi';
import { connectProvider, getProviderAdapter } from '@when/calendar';
import type { Provider } from '@when/config';
import { getProviderRefreshToken, recordServiceOutcome } from '@when/db';
import { requireProvider, providersAndName } from './shared.ts';
import { openAppDb, type AppDatabase } from '../../utils/db.ts';
import { pass, fail } from '../../utils/report.ts';

export const testCommand = define({
	name: 'test',
	description: 'authenticate a provider (Google token refresh / CalDAV PROPFIND)',
	args: {
		name: { type: 'positional', required: false, description: 'the provider to test' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' },
		refreshToken: {
			type: 'string',
			description: 'override the refresh token stored for a google provider'
		}
	},
	toKebab: true,
	async run(ctx) {
		const resolved = await providersAndName(ctx.values?.name, ctx.values?.config, 'test');
		if (!resolved) return;
		const db = await openAppDb(resolved.config);
		if (!db) return;
		try {
			await runProviderTest(
				resolved.config.providers ?? [],
				resolved.name,
				db,
				ctx.values?.refreshToken
			);
		} finally {
			await db.destroy();
		}
	}
});

export async function runProviderTest(
	providers: Provider[],
	name: string,
	db: AppDatabase,
	refreshToken?: string
): Promise<void> {
	const provider = requireProvider(providers, name);
	if (!provider) return;

	const token = refreshToken ?? (await getProviderRefreshToken(db, name));
	const adapter = getProviderAdapter(connectProvider(provider, token));
	if (adapter.usesOAuth && !token) {
		fail(`${name} (${provider.type}) — not connected; connect it from /admin`);
		return;
	}

	const at = Temporal.Now.instant().toString();
	try {
		await adapter.verify();
		await recordServiceOutcome(db, { kind: 'provider', name }, { at, via: 'test' });
		pass(`${name} (${provider.type}) — authenticated`);
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		await recordServiceOutcome(db, { kind: 'provider', name }, { at, via: 'test', error });
		fail(`${name} (${provider.type}) — ${error}`);
	}
}
