import { describe, expect, test } from 'vitest';
import { openDb } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { setWorkerContext, getWorkerContext } from './context.js';
import { createLogger } from './logger.js';

describe('worker context', () => {
	test('getWorkerContext throws before it is set', () => {
		expect(() => getWorkerContext()).toThrow(/not initialized/);
	});

	test('getWorkerContext returns exactly what was set', () => {
		const ctx = {
			config: {} as WhenConfiguration,
			logger: createLogger(),
			db: openDb(':memory:')
		};
		setWorkerContext(ctx);
		expect(getWorkerContext()).toBe(ctx);
	});
});
