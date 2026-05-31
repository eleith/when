import { expect, test } from 'vitest';
import { logger, loggerOptions } from '$lib/server/logger';

test('base label is set to app name', () => {
	expect(loggerOptions.base).toEqual({ app: 'when' });
});

test('level defaults to debug in test environment', () => {
	expect(loggerOptions.level).toBe('debug');
});

test('redact config uses [REDACTED] censor', () => {
	const redact = loggerOptions.redact;
	expect(typeof redact).toBe('object');
	if (redact && typeof redact === 'object' && 'censor' in redact) {
		expect(redact.censor).toBe('[REDACTED]');
	}
});

test('redact paths cover sensitive keys at root and nested', () => {
	const redact = loggerOptions.redact;
	const paths: string[] = Array.isArray(redact)
		? redact
		: redact && typeof redact === 'object' && 'paths' in redact
			? redact.paths
			: [];
	const rootKeys = [
		'password',
		'password_hash',
		'client_secret',
		'access_token',
		'refresh_token',
		'cancel_token',
		'authorization',
		'cookie'
	];
	const nestedKeys = [
		'password',
		'password_hash',
		'client_secret',
		'access_token',
		'refresh_token',
		'cancel_token'
	];
	for (const key of rootKeys) {
		expect(paths).toContain(key);
	}
	for (const key of nestedKeys) {
		expect(paths).toContain(`*.${key}`);
	}
});

test('logger exposes expected levels', () => {
	for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
		expect(typeof (logger as unknown as Record<string, unknown>)[level]).toBe('function');
	}
});
