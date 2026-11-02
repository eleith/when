import { makeAuth } from './auth';
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
	const config = await bootConfig();
	makeAuth(config);
	const db = openDb(config.database.app);
	const applied = await runMigrations(db);
	if (applied.length > 0) logger.info({ migrations: applied }, 'migrations applied');
	initOpenWorkflow({ dbPath: config.database.queue });
	setState({ config, db });

	const stopWatching = watchConfig((result) =>
		applyConfig(result, {
			current: () => getState().config,
			swap: (next) => setState({ config: next, db }),
			restart: () => process.exit(0)
		})
	);
	process.once('sveltekit:shutdown', stopWatching);
}
