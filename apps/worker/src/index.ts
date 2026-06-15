import { Temporal } from '@js-temporal/polyfill';
import { loadConfigFile } from '@when/config';
import { expireStalePending, openDb, runMigrations } from '@when/db';
import { initOpenWorkflow } from '@when/jobs';
import { setLogger } from '@when/calendar';
import { createMailer } from './email/smtp.js';
import { setWorkerContext, type WorkerContext } from './services/context.js';
import { createHealthServer } from './services/health.js';
import { createLogger, log } from './services/logger.js';
import { registerWorkflows } from './workflows/index.js';
import { registerSyncCalendarsWorkflow } from './workflows/sync-calendars.js';
import { refreshCycle } from './calendar/refresh.js';
import { createRefreshScheduler } from './calendar/scheduler.js';
import { scanOnce } from './calendar/sync.js';
import { createCalendarSyncScanner } from './calendar/sync-scanner.js';

const DEFAULT_PORT = 9000;
const CALENDAR_SYNC_FLOOR_MS = 10 * 60_000;
const REFRESH_TICK_MINUTES = 5;
const EXPIRE_TICK_MINUTES = 60;

async function main(): Promise<void> {
	const logger = createLogger();

	const config = await loadConfigFile();
	logger.info('config loaded', { user: config.user.email });

	const db = openDb(config.database.app);
	const applied = await runMigrations(db);
	if (applied.length > 0) logger.info('migrations applied', { migrations: applied });

	const ctx: WorkerContext = { config, logger, db, mailer: createMailer(config, logger) };
	setWorkerContext(ctx);

	setLogger({
		debug: (obj, msg) => logger.debug(msg, obj as Record<string, unknown>),
		warn: (obj, msg) => logger.warn(msg, obj as Record<string, unknown>),
		error: (obj, msg) => logger.error(msg, obj as Record<string, unknown>)
	});

	const calendarSync = createCalendarSyncScanner(async () => {
		try {
			await scanOnce(ctx);
		} catch (err) {
			logger.error('calendar sync failed', {
				error: err instanceof Error ? err.message : String(err)
			});
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
	logger.info('calendar refresh scheduled', { tickMinutes: REFRESH_TICK_MINUTES });

	const expireSweep = createRefreshScheduler(async () => {
		try {
			const expired = await expireStalePending(ctx.db, Temporal.Now.instant().toString());
			if (expired > 0) logger.info('expired stale pending requests', { count: expired });
		} catch (err) {
			logger.error('expire sweep failed', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}, EXPIRE_TICK_MINUTES * 60_000);
	expireSweep.start();
	logger.info('expiry sweep scheduled', { tickMinutes: EXPIRE_TICK_MINUTES });

	const port = Number(process.env.PORT) || DEFAULT_PORT;
	const server = createHealthServer();
	server.listen(port, () => logger.info('health server listening', { port }));

	const shutdown = async (signal: string): Promise<void> => {
		logger.info('worker shutting down', { signal });
		refresh.stop();
		expireSweep.stop();
		calendarSync.stop();
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
