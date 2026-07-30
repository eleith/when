import { makeAuth } from './auth';
import { requireAuthSecret } from './auth/secret';
import { getState, setState } from './state';
import { bootConfig } from './config/boot';
import { applyConfig } from './config/reload';
import { openDb, runMigrations } from '@when/db';
import { initOpenWorkflow } from '@when/jobs';
import { setLogger } from '@when/calendar';
import { watchConfig } from '@when/config';
import { logger } from './logger';

export async function bootApp(): Promise<void> {
	setLogger(logger);
	requireAuthSecret();
	const config = await bootConfig();
	const db = openDb(config.database.app);
	const applied = await runMigrations(db);
	if (applied.length > 0) logger.info({ migrations: applied }, 'migrations applied');
	initOpenWorkflow({ dbPath: config.database.queue });
	makeAuth(config);
	setState({ config, db });

	watchConfig((result) =>
		applyConfig(result, {
			current: () => getState().config,
			swap: (next) => setState({ config: next, db }),
			restart: () => process.exit(0)
		})
	);
}
