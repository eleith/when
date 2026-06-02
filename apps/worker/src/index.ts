import { loadConfigFile } from '@when/config';
import { openDb, runMigrations } from '@when/db';
import { initOpenWorkflow } from '@when/jobs';
import { resolveConfigPath } from './services/paths.js';
import { setWorkerContext } from './services/context.js';
import { createHealthServer } from './services/health.js';
import { createLogger, log } from './services/logger.js';
import { registerWorkflows } from './workflows/index.js';

const DEFAULT_PORT = 9000;

async function main(): Promise<void> {
	const logger = createLogger();

	const config = await loadConfigFile(resolveConfigPath());
	logger.info('config loaded', { user: config.user.email });

	const db = openDb(config.database.app);
	const applied = await runMigrations(db);
	if (applied.length > 0) logger.info('migrations applied', { migrations: applied });

	// Context is what workflow implementations reach for at run time.
	setWorkerContext({ config, logger, db });

	// Connect the openworkflow client, register handlers, then start polling.
	const client = initOpenWorkflow({ dbPath: config.database.queue });
	registerWorkflows();
	const worker = client.newWorker();
	await worker.start();
	logger.info('worker started');

	const port = Number(process.env.PORT) || DEFAULT_PORT;
	const server = createHealthServer();
	server.listen(port, () => logger.info('health server listening', { port }));

	const shutdown = async (signal: string): Promise<void> => {
		logger.info('worker shutting down', { signal });
		server.close();
		await worker.stop();
		process.exit(0);
	};
	process.on('SIGTERM', () => void shutdown('SIGTERM'));
	process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
	log('error', 'worker failed to start', {
		error: err instanceof Error ? err.message : String(err)
	});
	process.exit(1);
});
