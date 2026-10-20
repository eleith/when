import { loadConfig } from '@when/config';
import { openDb } from '@when/db';
import { closeOpenWorkflow } from '@when/jobs';
import { logger } from './services/logger.js';
import { createShutdown, type ShutdownResources } from './services/lifecycle.js';
import {
	initializeWorkerContext,
	startWorkflowWorker,
	enqueueStartupMaintenance,
	startHealthServer,
	watchConfigAndSignals
} from './services/startup.js';

async function main(): Promise<void> {
	const config = await loadConfig();
	logger.info({ user: config.user.email }, 'config loaded');

	const db = openDb(config.database.app);
	const resources: ShutdownResources = {
		closeQueue: closeOpenWorkflow,
		closeDatabase: () => db.destroy()
	};
	const shutdown = createShutdown(resources);

	try {
		const ctx = await initializeWorkerContext(config, db);
		const client = await startWorkflowWorker(ctx, resources);
		await enqueueStartupMaintenance(client);
		await startHealthServer(ctx, resources);
		watchConfigAndSignals(ctx, resources, shutdown);
	} catch (error) {
		try {
			await shutdown();
		} catch (shutdownError) {
			logger.error(
				{ error: shutdownError instanceof Error ? shutdownError.message : String(shutdownError) },
				'worker startup cleanup failed'
			);
		}
		throw error;
	}
}

main().catch((err) => {
	logger.error(
		{
			error: err instanceof Error ? err.message : String(err)
		},
		'worker failed to start'
	);
	process.exit(1);
});
