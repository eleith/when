import { existsSync } from 'node:fs';
import { define } from 'gunshi';
import { migrationStatus, openDb } from '@when/db';
import { loadConfigFromCtx } from '../../utils/command.ts';
import { pass, fail, detail } from '../../utils/report.ts';

export const statusCommand = define({
	name: 'status',
	description: 'report the database path and any pending migrations',
	args: {
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	toKebab: true,
	async run(ctx) {
		const config = await loadConfigFromCtx(ctx.values?.config);
		if (config) await runDbStatus(config.database.app);
	}
});

// Opens nothing when the file is absent: `openDb` would create the database this command
// exists to report on.
export async function runDbStatus(path: string): Promise<void> {
	if (!existsSync(path)) {
		fail(`no database at ${path}`);
		detail('run when-cli db migrate, or start the app once');
		return;
	}

	const db = openDb(path);
	try {
		const { applied, pending } = await migrationStatus(db);
		if (pending.length === 0) {
			pass(`${path} — ${applied.length} migration(s) applied, up to date`);
			return;
		}
		fail(`${path} — ${applied.length} applied, ${pending.length} pending`);
		for (const name of pending) detail(name);
	} finally {
		await db.destroy();
	}
}
