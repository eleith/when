import { makeAuth } from './auth';
import { setState } from './state';
import { resolve } from 'node:path';
import { bootConfig } from './config/boot';
import { applyConfig } from './config/reload';
import { openDb, runMigrations } from '@when/db';
import { initOpenWorkflow } from '@when/jobs';
import { setLogger } from '@when/calendar';
import {
	loadConfigFile,
	resolveConfigPath,
	startConfigReloading,
	type ConfigPathOptions
} from '@when/config';
import { logger } from './logger';

export async function bootApp(options: ConfigPathOptions = {}): Promise<void> {
	setLogger(logger);
	const context = { env: options.env ?? process.env, cwd: options.cwd ?? process.cwd() };
	const selectedPath = resolveConfigPath(context);
	const config = await bootConfig(selectedPath, context);
	makeAuth(config);
	const db = openDb(config.database.app);
	const applied = await runMigrations(db);
	if (applied.length > 0) logger.info({ migrations: applied }, 'migrations applied');
	initOpenWorkflow({ dbPath: config.database.queue });
	setState({ config, db });

	const monitor = startConfigReloading({
		path: resolve(context.cwd, selectedPath),
		initial: config,
		load: () => loadConfigFile(selectedPath, context),
		onChange: (next, previous) =>
			applyConfig(next, previous, {
				swap: (next) => setState({ config: next, db }),
				restart: () => process.exit(0)
			}),
		onError: (error) => logger.error({ err: error }, 'config reload failed; keeping current config')
	});
	process.once('sveltekit:shutdown', monitor.stop);
	await monitor.ready;
}
