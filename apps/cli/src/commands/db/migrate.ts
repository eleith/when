import { define } from 'gunshi';
import { runMigrations } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { loadConfigFromCtx } from '../../utils/command.ts';
import { openAppDbForMigration } from '../../utils/db.ts';
import { pass, fail, detail } from '../../utils/report.ts';

export const migrateCommand = define({
	name: 'migrate',
	description: 'apply any pending database migrations',
	args: {
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	toKebab: true,
	async run(ctx) {
		const config = await loadConfigFromCtx(ctx.values?.config);
		if (config) await runDbMigrate(config);
	}
});

export async function runDbMigrate(config: WhenConfiguration): Promise<void> {
	const db = openAppDbForMigration(config);
	try {
		const applied = await runMigrations(db);
		if (applied.length === 0) {
			pass(`${config.database.app} — already up to date`);
			return;
		}
		pass(`${config.database.app} — ${applied.length} migration(s) applied:`);
		for (const name of applied) detail(name);
	} catch (err) {
		fail(`migration failed — ${err instanceof Error ? err.message : String(err)}`);
	} finally {
		await db.destroy();
	}
}
