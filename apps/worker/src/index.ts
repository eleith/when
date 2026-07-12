import { loadConfig, watchConfig } from '@when/config';
import { expireStalePending, openDb, runMigrations } from '@when/db';
import { initOpenWorkflow } from '@when/jobs';
import { setLogger } from '@when/calendar';
import { createMailer } from './email/smtp.js';
import { applyConfig } from './services/config-reload.js';
import { setWorkerContext, type WorkerContext } from './services/context.js';
import { createHealthServer } from './services/health.js';
import { logger } from './services/logger.js';
import { registerWorkflows } from './workflows/index.js';
import { registerSyncCalendarsWorkflow } from './workflows/sync-calendars.js';
import { refreshCycle } from './calendar/refresh.js';
import { createRefreshScheduler } from './calendar/scheduler.js';
import { scanOnce } from './calendar/sync.js';
import { createCalendarSyncScanner } from './calendar/sync-scanner.js';
import { calendarSyncTotal } from './services/metrics.js';

const DEFAULT_PORT = 9000;
const CALENDAR_SYNC_FLOOR_MS = 10 * 60_000;
const REFRESH_TICK_MINUTES = 5;
const EXPIRE_TICK_MINUTES = 60;

async function main(): Promise<void> {
	const config = await loadConfig();
	logger.info({ user: config.user.email }, 'config loaded');

	const db = openDb(config.database.app);
	const applied = await runMigrations(db);
	if (applied.length > 0) logger.info({ migrations: applied }, 'migrations applied');

	const ctx: WorkerContext = { config, logger, db, mailer: createMailer(config, logger) };
	setWorkerContext(ctx);

	setLogger(logger);

	const calendarSync = createCalendarSyncScanner(async () => {
		try {
			await scanOnce(ctx);
			calendarSyncTotal.inc({ status: 'success' });
		} catch (err) {
			calendarSyncTotal.inc({ status: 'failure' });
			logger.error(
				{
					error: err instanceof Error ? err.message : String(err)
				},
				'calendar sync failed'
			);
		}
	}, CALENDAR_SYNC_FLOOR_MS);

	const client = initOpenWorkflow({ dbPath: config.database.queue });
	registerWorkflows();
	registerSyncCalendarsWorkflow(calendarSync);
	const worker = client.newWorker();
	await worker.start();
	logger.info('worker started');

	calendarSync.requestScan();

	const refresh = createRefreshScheduler(() => refreshCycle(ctx), REFRESH_TICK_MINUTES * 60_000);
	refresh.start();
	logger.info({ tickMinutes: REFRESH_TICK_MINUTES }, 'calendar refresh scheduled');

	const expireSweep = createRefreshScheduler(async () => {
		try {
			const expired = await expireStalePending(ctx.db, Temporal.Now.instant().toString());
			if (expired > 0) logger.info({ count: expired }, 'expired stale pending requests');
		} catch (err) {
			logger.error(
				{
					error: err instanceof Error ? err.message : String(err)
				},
				'expire sweep failed'
			);
		}
	}, EXPIRE_TICK_MINUTES * 60_000);
	expireSweep.start();
	logger.info({ tickMinutes: EXPIRE_TICK_MINUTES }, 'expiry sweep scheduled');

	const port = Number(process.env.PORT) || DEFAULT_PORT;
	const server = createHealthServer(() => ctx.config);
	server.listen(port, () => logger.info({ port }, 'health server listening'));

	let stopWatch: () => void = () => {};

	const shutdown = async (signal: string): Promise<void> => {
		logger.info({ signal }, 'worker shutting down');
		stopWatch();
		refresh.stop();
		expireSweep.stop();
		calendarSync.stop();
		server.close();
		await worker.stop();
		process.exit(0);
	};

	stopWatch = watchConfig((result) =>
		applyConfig(result, ctx, () => void shutdown('config-change'))
	);

	process.on('SIGTERM', () => void shutdown('SIGTERM'));
	process.on('SIGINT', () => void shutdown('SIGINT'));
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
