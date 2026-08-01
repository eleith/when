import { define } from 'gunshi';
import type { Provider } from '@when/config';
import { listServiceStatus } from '@when/db';
import { loadConfigFromCtx } from '../../utils/command.ts';
import { openAppDb, type AppDatabase } from '../../utils/db.ts';
import { pass, fail } from '../../utils/report.ts';

export async function runProviderList(providers: Provider[], db: AppDatabase): Promise<void> {
	if (providers.length === 0) {
		console.log('No providers configured.');
		return;
	}

	const observed = new Map((await listServiceStatus(db, 'provider')).map((s) => [s.name, s]));

	for (const provider of providers) {
		const label = `${provider.name} (${provider.type})`;
		const status = observed.get(provider.name);
		if (!status) console.log(`${label} — not yet observed`);
		else if (status.error)
			fail(`${label} — failing since ${status.failing_since}: ${status.error}`);
		else pass(`${label} — working, last confirmed ${status.last_ok_at}`);
	}
}

export const listCommand = define({
	name: 'list',
	description: 'list configured providers',
	args: {
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	async run(ctx) {
		const config = await loadConfigFromCtx(ctx.values?.config);
		if (!config) return;
		const db = await openAppDb(config);
		if (!db) return;
		try {
			await runProviderList(config.providers ?? [], db);
		} finally {
			await db.destroy();
		}
	}
});
