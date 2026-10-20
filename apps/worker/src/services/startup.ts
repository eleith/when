import { once } from 'node:events';
import { watchConfig, type WhenConfiguration } from '@when/config';
import { runMigrations } from '@when/db';
import {
	expirePendingAppointments,
	initOpenWorkflow,
	refreshCalendars,
	syncCalendars
} from '@when/jobs';
import { setLogger } from '@when/calendar';
import type { OpenWorkflow } from 'openworkflow';
import { createMailer } from '../email/smtp.js';
import { registerWorkflows } from '../workflows/index.js';
import { applyConfig } from './config-reload.js';
import { setWorkerContext, type WorkerContext } from './context.js';
import { createEngineLogger } from './engine-logger.js';
import { createHealthServer } from './health.js';
import type { ShutdownResources } from './lifecycle.js';
import { logger } from './logger.js';

const DEFAULT_PORT = 9000;

export async function initializeWorkerContext(
	config: WhenConfiguration,
	db: WorkerContext['db']
): Promise<WorkerContext> {
	const applied = await runMigrations(db);
	if (applied.length > 0) logger.info({ migrations: applied }, 'migrations applied');

	const ctx: WorkerContext = { config, logger, db, mailer: createMailer(config, logger) };
	setWorkerContext(ctx);
	setLogger(logger);
	return ctx;
}

export async function startWorkflowWorker(
	ctx: WorkerContext,
	resources: ShutdownResources
): Promise<OpenWorkflow> {
	const client = initOpenWorkflow({
		dbPath: ctx.config.database.queue,
		logger: createEngineLogger(ctx.logger)
	});
	registerWorkflows();
	const worker = client.newWorker();
	resources.worker = worker;
	await worker.start();
	ctx.logger.info('worker started');
	return client;
}

export async function enqueueStartupMaintenance(client: OpenWorkflow): Promise<void> {
	await client.runWorkflow(refreshCalendars, {});
	await client.runWorkflow(expirePendingAppointments, {});
	await client.runWorkflow(syncCalendars, {});
}

export async function startHealthServer(
	ctx: WorkerContext,
	resources: ShutdownResources
): Promise<void> {
	const port = Number(process.env.PORT) || DEFAULT_PORT;
	const server = createHealthServer(() => ctx.config);
	resources.server = server;
	server.listen(port);
	await once(server, 'listening');
	ctx.logger.info({ port }, 'health server listening');
}

export function watchConfigAndSignals(
	ctx: WorkerContext,
	resources: ShutdownResources,
	shutdown: () => Promise<void>
): void {
	const requestShutdown = (signal: string): void => {
		ctx.logger.info({ signal }, 'worker shutting down');
		void shutdown().then(
			() => process.exit(0),
			(error) => {
				ctx.logger.error(
					{ error: error instanceof Error ? error.message : String(error) },
					'worker shutdown failed'
				);
				process.exit(1);
			}
		);
	};

	resources.stopWatch = watchConfig((result) =>
		applyConfig(result, ctx, () => requestShutdown('config-change'))
	);
	process.on('SIGTERM', () => requestShutdown('SIGTERM'));
	process.on('SIGINT', () => requestShutdown('SIGINT'));
}
