import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ReloadResult, WhenConfiguration } from '@when/config';
import { expirePendingAppointments, refreshCalendars, syncCalendars } from '@when/jobs';

const mocks = vi.hoisted(() => ({
	loadConfig: vi.fn(),
	watchConfig: vi.fn(),
	stopWatch: vi.fn(),
	openDb: vi.fn(),
	runMigrations: vi.fn(),
	destroy: vi.fn(),
	initOpenWorkflow: vi.fn(),
	closeOpenWorkflow: vi.fn(),
	newWorker: vi.fn(),
	start: vi.fn(),
	stop: vi.fn(),
	runWorkflow: vi.fn(),
	result: vi.fn(),
	setLogger: vi.fn(),
	createMailer: vi.fn(),
	setWorkerContext: vi.fn(),
	createHealthServer: vi.fn(),
	createEngineLogger: vi.fn(),
	registerWorkflows: vi.fn(),
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('@when/config', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/config')>();
	return { ...actual, loadConfig: mocks.loadConfig, watchConfig: mocks.watchConfig };
});
vi.mock('@when/db', () => ({ openDb: mocks.openDb, runMigrations: mocks.runMigrations }));
vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return {
		...actual,
		initOpenWorkflow: mocks.initOpenWorkflow,
		closeOpenWorkflow: mocks.closeOpenWorkflow
	};
});
vi.mock('@when/calendar', () => ({ setLogger: mocks.setLogger }));
vi.mock('./email/smtp.js', () => ({ createMailer: mocks.createMailer }));
vi.mock('./services/context.js', () => ({ setWorkerContext: mocks.setWorkerContext }));
vi.mock('./services/health.js', () => ({ createHealthServer: mocks.createHealthServer }));
vi.mock('./services/logger.js', () => ({ logger: mocks.logger }));
vi.mock('./services/engine-logger.js', () => ({ createEngineLogger: mocks.createEngineLogger }));
vi.mock('./workflows/index.js', () => ({ registerWorkflows: mocks.registerWorkflows }));

const config = {
	user: { name: 'Owner', email: 'owner@example.test', timezone: 'UTC' },
	database: { app: '/fixture/app.sqlite', queue: '/fixture/queue.sqlite' },
	smtp: { host: 'smtp.example.test', port: 587, username: 'owner', password: 'test' }
} as WhenConfiguration;
const db = { destroy: mocks.destroy };
const mailer = {};
const engineLogger = {};
const worker = { start: mocks.start, stop: mocks.stop };
const client = { newWorker: mocks.newWorker, runWorkflow: mocks.runWorkflow };
let events: string[];
let signals: Map<string, () => void>;
let reload: (result: ReloadResult) => void;
let server: EventEmitter & {
	listening: boolean;
	listen: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
};

function finishListening() {
	server.listening = true;
	server.emit('listening');
}

async function boot() {
	await import('./index.js');
	await vi.waitFor(() => {
		expect(mocks.watchConfig).toHaveBeenCalledOnce();
		expect(signals.has('SIGTERM')).toBe(true);
		expect(signals.has('SIGINT')).toBe(true);
	});
}

beforeEach(() => {
	vi.resetModules();
	vi.resetAllMocks();
	vi.stubEnv('PORT', '19099');
	events = [];
	signals = new Map();
	vi.spyOn(process, 'on').mockImplementation((event, listener) => {
		if (event === 'SIGTERM' || event === 'SIGINT') signals.set(event, listener);
		return process;
	});
	vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
	mocks.loadConfig.mockResolvedValue(config);
	mocks.openDb.mockReturnValue(db);
	mocks.runMigrations.mockResolvedValue([]);
	mocks.createMailer.mockReturnValue(mailer);
	mocks.createEngineLogger.mockReturnValue(engineLogger);
	mocks.initOpenWorkflow.mockReturnValue(client);
	mocks.newWorker.mockReturnValue(worker);
	mocks.start.mockImplementation(async () => {
		events.push('worker:start');
	});
	mocks.runWorkflow.mockImplementation(async (spec: { name: string }) => {
		events.push(`enqueue:${spec.name}`);
		return { result: mocks.result };
	});
	mocks.stopWatch.mockImplementation(() => {
		events.push('watch:stop');
	});
	mocks.watchConfig.mockImplementation((callback: typeof reload) => {
		reload = callback;
		return mocks.stopWatch;
	});
	mocks.stop.mockImplementation(async () => {
		events.push('worker:stop');
	});
	mocks.closeOpenWorkflow.mockImplementation(async () => {
		events.push('queue:close');
	});
	mocks.destroy.mockImplementation(async () => {
		events.push('db:close');
	});
	server = Object.assign(new EventEmitter(), {
		listening: false,
		listen: vi.fn(() => {
			events.push('server:listen');
			queueMicrotask(finishListening);
			return server;
		}),
		close: vi.fn((callback: (error?: Error) => void) => {
			events.push('server:close');
			server.listening = false;
			queueMicrotask(() => {
				events.push('server:closed');
				server.emit('close');
				callback();
			});
			return server;
		})
	});
	mocks.createHealthServer.mockReturnValue(server);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

test('registers workflows before starting one default worker, then enqueues all maintenance', async () => {
	const started = Promise.withResolvers<void>();
	mocks.start.mockImplementation(async () => {
		events.push('worker:start');
		await started.promise;
		events.push('worker:started');
	});
	await import('./index.js');
	await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
	expect(mocks.runWorkflow).not.toHaveBeenCalled();
	expect(mocks.createHealthServer).not.toHaveBeenCalled();
	expect(mocks.loadConfig).toHaveBeenCalledWith();
	expect(mocks.openDb).toHaveBeenCalledWith(config.database.app);
	expect(mocks.runMigrations).toHaveBeenCalledWith(db);
	expect(mocks.createMailer).toHaveBeenCalledWith(config, mocks.logger);
	expect(mocks.setWorkerContext).toHaveBeenCalledWith({ config, db, mailer, logger: mocks.logger });
	expect(mocks.setLogger).toHaveBeenCalledWith(mocks.logger);
	expect(mocks.createEngineLogger).toHaveBeenCalledWith(mocks.logger);
	expect(mocks.initOpenWorkflow).toHaveBeenCalledWith({
		dbPath: config.database.queue,
		logger: engineLogger
	});
	expect(mocks.registerWorkflows).toHaveBeenCalledOnce();
	expect(mocks.initOpenWorkflow).toHaveBeenCalledBefore(mocks.registerWorkflows);
	expect(mocks.registerWorkflows).toHaveBeenCalledBefore(mocks.newWorker);
	expect(mocks.newWorker).toHaveBeenCalledWith();

	started.resolve();
	await vi.waitFor(() => expect(mocks.watchConfig).toHaveBeenCalledOnce());
	expect(mocks.runWorkflow.mock.calls).toEqual([
		[refreshCalendars, {}],
		[expirePendingAppointments, {}],
		[syncCalendars, {}]
	]);
	expect(mocks.runWorkflow.mock.calls.map(([spec]) => spec.name)).toEqual([
		'refresh-calendars',
		'expire-pending-appointments',
		'sync-calendars'
	]);
	expect(mocks.result).not.toHaveBeenCalled();
	expect(events).toEqual([
		'worker:start',
		'worker:started',
		'enqueue:refresh-calendars',
		'enqueue:expire-pending-appointments',
		'enqueue:sync-calendars',
		'server:listen'
	]);
	expect(server.listen.mock.calls[0][0]).toBe(19099);
	const getConfig = mocks.createHealthServer.mock.calls[0][0] as () => WhenConfiguration;
	expect(getConfig()).toBe(config);
	expect(process.exit).not.toHaveBeenCalled();
});

test.each([0, 1, 2])(
	'awaits startup enqueue %i and HTTP listening before watching config or installing signals',
	async (index) => {
		const enqueued = Promise.withResolvers<void>();
		for (let preceding = 0; preceding < index; preceding++) {
			mocks.runWorkflow.mockResolvedValueOnce({ result: mocks.result });
		}
		mocks.runWorkflow.mockImplementationOnce(() => enqueued.promise);
		server.listen.mockImplementation(() => server);
		await import('./index.js');
		await vi.waitFor(() => expect(mocks.runWorkflow).toHaveBeenCalledTimes(index + 1));
		expect(mocks.createHealthServer).not.toHaveBeenCalled();
		enqueued.resolve();
		await vi.waitFor(() => expect(server.listen).toHaveBeenCalledOnce());
		expect(mocks.runWorkflow).toHaveBeenCalledTimes(3);
		expect(mocks.watchConfig).not.toHaveBeenCalled();
		expect(signals.size).toBe(0);
		finishListening();
		await vi.waitFor(() => expect(mocks.watchConfig).toHaveBeenCalledOnce());
		expect(signals.size).toBe(2);
	}
);

test('signals and restart-required config changes share one safe resource shutdown', async () => {
	await boot();
	const stopped = Promise.withResolvers<void>();
	const httpClosed = Promise.withResolvers<void>();
	const queueClosed = Promise.withResolvers<void>();
	mocks.closeOpenWorkflow.mockImplementation(async () => {
		events.push('queue:close');
		await queueClosed.promise;
	});
	mocks.stop.mockImplementation(async () => {
		events.push('worker:stop');
		await stopped.promise;
		events.push('worker:stopped');
	});
	server.close.mockImplementation((callback: () => void) => {
		events.push('server:close');
		void httpClosed.promise.then(() => {
			events.push('server:closed');
			callback();
		});
		return server;
	});
	events = [];
	signals.get('SIGTERM')!();
	signals.get('SIGINT')!();
	reload({ ok: true, config: { ...config, database: { ...config.database, app: '/new.sqlite' } } });
	expect(events).toEqual(['watch:stop', 'server:close', 'worker:stop']);
	expect(mocks.closeOpenWorkflow).not.toHaveBeenCalled();
	expect(mocks.destroy).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
	stopped.resolve();
	await vi.waitFor(() => expect(events).toContain('worker:stopped'));
	expect(mocks.closeOpenWorkflow).not.toHaveBeenCalled();
	httpClosed.resolve();
	await vi.waitFor(() => expect(mocks.closeOpenWorkflow).toHaveBeenCalledOnce());
	expect(mocks.destroy).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
	queueClosed.resolve();
	await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
	expect(events).toEqual([
		'watch:stop',
		'server:close',
		'worker:stop',
		'worker:stopped',
		'server:closed',
		'queue:close',
		'db:close'
	]);
	for (const close of [
		mocks.stopWatch,
		server.close,
		mocks.stop,
		mocks.closeOpenWorkflow,
		mocks.destroy
	]) {
		expect(close).toHaveBeenCalledOnce();
	}
});

test.each(['migration', 'start', 'enqueue', 'listen'] as const)(
	'%s failure awaits cleanup of partially created resources before exiting',
	async (stage) => {
		const failure = new Error(`${stage} failed`);
		if (stage === 'migration') mocks.runMigrations.mockRejectedValue(failure);
		if (stage === 'start') mocks.start.mockRejectedValue(failure);
		if (stage === 'enqueue') mocks.runWorkflow.mockRejectedValueOnce(failure);
		if (stage === 'listen') {
			server.listen.mockImplementation(() => {
				queueMicrotask(() => server.emit('error', failure));
				return server;
			});
		}
		const databaseClosed = Promise.withResolvers<void>();
		mocks.destroy.mockImplementation(async () => {
			events.push('db:close');
			await databaseClosed.promise;
		});
		await import('./index.js');
		await vi.waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
		expect(process.exit).not.toHaveBeenCalled();
		expect(mocks.watchConfig).not.toHaveBeenCalled();
		expect(signals.size).toBe(0);
		if (stage === 'migration') {
			expect(mocks.initOpenWorkflow).not.toHaveBeenCalled();
			expect(mocks.stop).not.toHaveBeenCalled();
		} else {
			expect(mocks.stop).toHaveBeenCalledOnce();
			expect(mocks.stop).toHaveBeenCalledBefore(mocks.closeOpenWorkflow);
			expect(mocks.closeOpenWorkflow).toHaveBeenCalledBefore(mocks.destroy);
		}
		if (stage !== 'listen') expect(mocks.createHealthServer).not.toHaveBeenCalled();
		databaseClosed.resolve();
		await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
		expect(mocks.logger.error).toHaveBeenCalledWith(
			{ error: failure.message },
			'worker failed to start'
		);
	}
);

test.each(['SIGTERM', 'SIGINT', 'config-change'])(
	'%s handles rejected worker stop without closing live connections',
	async (trigger) => {
		await boot();
		mocks.stop.mockRejectedValue(new Error('active work did not stop'));
		if (trigger === 'config-change') {
			reload({
				ok: true,
				config: { ...config, smtp: { ...config.smtp, host: 'new.example.test' } }
			});
		} else {
			signals.get(trigger)!();
		}
		await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
		expect(mocks.logger.error).toHaveBeenCalled();
		expect(process.exit).not.toHaveBeenCalledWith(0);
		expect(mocks.stopWatch).toHaveBeenCalledOnce();
		expect(server.close).toHaveBeenCalledOnce();
		expect(mocks.closeOpenWorkflow).not.toHaveBeenCalled();
		expect(mocks.destroy).not.toHaveBeenCalled();
	}
);

test('queue close rejection still closes the app database and exits unsuccessfully', async () => {
	await boot();
	mocks.closeOpenWorkflow.mockRejectedValue(new Error('queue close failed'));
	signals.get('SIGTERM')!();
	await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
	expect(mocks.stop).toHaveBeenCalledBefore(mocks.closeOpenWorkflow);
	expect(mocks.closeOpenWorkflow).toHaveBeenCalledBefore(mocks.destroy);
	expect(mocks.destroy).toHaveBeenCalledOnce();
	expect(mocks.logger.error).toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalledWith(0);
});

test('startup cleanup handles a failed stop without closing connections or losing the boot error', async () => {
	mocks.start.mockRejectedValue(new Error('start failed'));
	mocks.stop.mockRejectedValue(new Error('stop failed'));
	await import('./index.js');
	await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
	expect(mocks.stop).toHaveBeenCalledOnce();
	expect(mocks.closeOpenWorkflow).not.toHaveBeenCalled();
	expect(mocks.destroy).not.toHaveBeenCalled();
	expect(mocks.logger.error.mock.calls).toEqual([
		[{ error: 'stop failed' }, 'worker startup cleanup failed'],
		[{ error: 'start failed' }, 'worker failed to start']
	]);
});

test('startup cleanup closes the app database even if closing the queue fails', async () => {
	mocks.runWorkflow.mockRejectedValueOnce(new Error('enqueue failed'));
	mocks.closeOpenWorkflow.mockRejectedValue(new Error('queue close failed'));
	await import('./index.js');
	await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
	expect(mocks.stop).toHaveBeenCalledBefore(mocks.closeOpenWorkflow);
	expect(mocks.closeOpenWorkflow).toHaveBeenCalledBefore(mocks.destroy);
	expect(mocks.destroy).toHaveBeenCalledOnce();
	expect(mocks.logger.error.mock.calls).toEqual([
		[{ error: 'queue close failed' }, 'worker startup cleanup failed'],
		[{ error: 'enqueue failed' }, 'worker failed to start']
	]);
});
