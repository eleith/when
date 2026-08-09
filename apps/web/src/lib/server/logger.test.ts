import { expect, test } from 'vitest';
import pino from 'pino';
import { logger, loggerOptions } from './logger';

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

test('redacts a provider secret nested under its provider name', () => {
	const lines: string[] = [];
	const log = pino({ ...loggerOptions, transport: undefined }, {
		write: (line: string) => void lines.push(line)
	} as unknown as NodeJS.WritableStream);

	log.info(
		{
			providers: {
				'my-google': { client_secret: 'CSEC', refresh_token: 'RTOK' },
				'my-dav': { password: 'PASS' }
			}
		},
		'boot'
	);

	const written = lines.join('');
	expect(written).not.toContain('CSEC');
	expect(written).not.toContain('RTOK');
	expect(written).not.toContain('PASS');
});

test('redacts the prometheus scrape token', () => {
	const lines: string[] = [];
	const log = pino({ ...loggerOptions, transport: undefined }, {
		write: (line: string) => void lines.push(line)
	} as unknown as NodeJS.WritableStream);

	log.info({ prometheus: { enabled: true, token: 'SCRAPE' } }, 'boot');
	log.info({ config: { prometheus: { enabled: true, token: 'SCRAPE' } } }, 'boot');

	expect(lines.join('')).not.toContain('SCRAPE');
});
