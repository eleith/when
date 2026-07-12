import { expect, test, vi } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import { applyConfig } from './reload';

function cfg(overrides: Record<string, unknown> = {}): WhenConfiguration {
	return {
		auth: { credentials: { username: 'admin', password: 'p' } },
		database: { app: '/data/app.sqlite', queue: '/data/queue.sqlite' },
		user: { name: 'A', email: 'a@example.com', timezone: 'UTC' },
		...overrides
	} as unknown as WhenConfiguration;
}

function effects(current: WhenConfiguration) {
	return { current: () => current, swap: vi.fn(), restart: vi.fn() };
}

test('applies a soft change via swap without restarting', () => {
	const fx = effects(cfg({ user: { name: 'Old' } }));
	const next = cfg({ user: { name: 'New' } });

	applyConfig({ ok: true, config: next }, fx);

	expect(fx.swap).toHaveBeenCalledWith(next);
	expect(fx.restart).not.toHaveBeenCalled();
});

test('restarts when auth changes', () => {
	const fx = effects(cfg());
	const next = cfg({ auth: { credentials: { username: 'admin', password: 'changed' } } });

	applyConfig({ ok: true, config: next }, fx);

	expect(fx.restart).toHaveBeenCalledOnce();
	expect(fx.swap).not.toHaveBeenCalled();
});

test('restarts when the database section changes', () => {
	const fx = effects(cfg());
	const next = cfg({ database: { app: '/other/app.sqlite', queue: '/data/queue.sqlite' } });

	applyConfig({ ok: true, config: next }, fx);

	expect(fx.restart).toHaveBeenCalledOnce();
});

test('keeps the current config when the reload failed', () => {
	const fx = effects(cfg());

	applyConfig({ ok: false, error: new Error('bad config') }, fx);

	expect(fx.swap).not.toHaveBeenCalled();
	expect(fx.restart).not.toHaveBeenCalled();
});
