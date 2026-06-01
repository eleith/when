import { loadConfigFile } from '@when/config';
import { openDb, runMigrations } from '@when/db';
import { resolveConfigPath } from './services/paths';
import { createQueueClient } from './services/queue';
import { createHealthServer } from './services/health';
import { createLogger, log } from './services/logger';

const DEFAULT_PORT = 9000;

async function main(): Promise<void> {
	const logger = createLogger();

	const config = await loadConfigFile(resolveConfigPath());
	logger.info('config loaded', { user: config.user.email });

	const db = openDb(config.database.app);
	const applied = await runMigrations(db);
	if (applied.length > 0) logger.info('migrations applied', { migrations: applied });

	// Connect the queue and start polling. No workflows are registered yet —
	// the worker boots and idles until send-booking-email lands in a later step.
	const client = createQueueClient(config.database.queue);
	const worker = client.newWorker();
	await worker.start();
	logger.info('worker started');

	const port = Number(process.env.PORT) || DEFAULT_PORT;
	createHealthServer().listen(port, () => logger.info('health server listening', { port }));
}

main().catch((err) => {
	log('error', 'worker failed to start', {
		error: err instanceof Error ? err.message : String(err)
	});
	process.exit(1);
});
