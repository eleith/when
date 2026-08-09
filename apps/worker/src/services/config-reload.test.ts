import { expect, test, vi } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import { applyConfig } from './config-reload.js';
import type { WorkerContext } from './context.js';

function cfg(overrides: Record<string, unknown> = {}): WhenConfiguration {
	return {
		smtp: { host: 'smtp.example.com', port: 587, username: 'u', password: 'p' },
		database: { app: '/data/app.sqlite', queue: '/data/queue.sqlite' },
		user: { name: 'A', email: 'a@example.com', timezone: 'UTC' },
		...overrides
	} as unknown as WhenConfiguration;
}

function fakeCtx(config: WhenConfiguration): WorkerContext {
	return {
		config,
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		db: {},
		mailer: {}
	} as unknown as WorkerContext;
}

test('applies a soft change in place without restarting', () => {
	const ctx = fakeCtx(cfg({ user: { name: 'Old' } }));
	const next = cfg({ user: { name: 'New' } });
	const onRestart = vi.fn();

	applyConfig({ ok: true, config: next }, ctx, onRestart);

	expect(ctx.config).toBe(next);
	expect(onRestart).not.toHaveBeenCalled();
});

test('restarts when a restart-required key (smtp) changes', () => {
	const old = cfg();
	const ctx = fakeCtx(old);
	const next = cfg({ smtp: { host: 'new.example.com', port: 587, username: 'u', password: 'p' } });
	const onRestart = vi.fn();

	applyConfig({ ok: true, config: next }, ctx, onRestart);

	expect(onRestart).toHaveBeenCalledOnce();
	expect(ctx.config).toBe(old); // not swapped — the reboot picks up the change
});

test('restarts when the database section changes', () => {
	const ctx = fakeCtx(cfg());
	const next = cfg({ database: { app: '/other/app.sqlite', queue: '/data/queue.sqlite' } });
	const onRestart = vi.fn();

	applyConfig({ ok: true, config: next }, ctx, onRestart);

	expect(onRestart).toHaveBeenCalledOnce();
});

test('keeps the current config when the reload failed', () => {
	const old = cfg();
	const ctx = fakeCtx(old);
	const onRestart = vi.fn();

	applyConfig({ ok: false, error: new Error('bad config') }, ctx, onRestart);

	expect(ctx.config).toBe(old);
	expect(onRestart).not.toHaveBeenCalled();
});
