import { expect, test, vi } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import { validConfig } from '../__fixtures__/valid-config';
import { applyConfig } from './reload';

function effects() {
	return { swap: vi.fn(), restart: vi.fn() };
}

test('accepts a soft change through swap without restarting', () => {
	const fx = effects();
	const next = { ...validConfig, user: { ...validConfig.user, name: 'Updated owner' } };

	expect(applyConfig(next, validConfig, fx)).toBe(true);
	expect(fx.swap).toHaveBeenCalledWith(next);
	expect(fx.restart).not.toHaveBeenCalled();
});

test('rejects changed authentication and requests a restart without swapping', () => {
	const fx = effects();
	const next = {
		...validConfig,
		auth: { credentials: { username: 'admin', password: 'changed-password' } }
	};

	expect(applyConfig(next, validConfig, fx)).toBe(false);
	expect(fx.restart).toHaveBeenCalledOnce();
	expect(fx.swap).not.toHaveBeenCalled();
});

test('rejects changed database settings and requests a restart', () => {
	const fx = effects();
	const next = {
		...validConfig,
		database: { ...validConfig.database, app: '/other/app.sqlite' }
	};

	expect(applyConfig(next, validConfig, fx)).toBe(false);
	expect(fx.restart).toHaveBeenCalledOnce();
	expect(fx.swap).not.toHaveBeenCalled();
});

test('rejects a changed public app URL because authentication was built for the original', () => {
	const fx = effects();
	const next = { ...validConfig, url: { ...validConfig.url, app: 'https://changed.example.com' } };

	expect(applyConfig(next, validConfig, fx)).toBe(false);
	expect(fx.restart).toHaveBeenCalledOnce();
	expect(fx.swap).not.toHaveBeenCalled();
});

test('accepts internal service URL changes without restarting', () => {
	const fx = effects();
	const next = {
		...validConfig,
		url: {
			...validConfig.url,
			internal: 'https://internal.example.com',
			worker: 'http://worker.example.com:9000'
		}
	};

	expect(applyConfig(next, validConfig, fx)).toBe(true);
	expect(fx.swap).toHaveBeenCalledWith(next);
	expect(fx.restart).not.toHaveBeenCalled();
});

test('applies a declaration-order-only meeting change', () => {
	const meeting = validConfig.meetings['30-min-chat'];
	const previous = { ...validConfig, meetings: { first: meeting, second: meeting } };
	const next = { ...previous, meetings: { second: meeting, first: meeting } };
	let current: WhenConfiguration = previous;
	const fx = {
		swap: (config: WhenConfiguration) => {
			current = config;
		},
		restart: vi.fn()
	};

	expect(applyConfig(next, previous, fx)).toBe(true);
	expect(Object.keys(current.meetings)).toEqual(['second', 'first']);
	expect(fx.restart).not.toHaveBeenCalled();
});
