import { expect, test } from 'bun:test';
import pino from 'pino';
import { logger } from '../src/lib/server/logger';

test('logger exposes standard levels', () => {
	expect(typeof logger.trace).toBe('function');
	expect(typeof logger.debug).toBe('function');
	expect(typeof logger.info).toBe('function');
	expect(typeof logger.warn).toBe('function');
	expect(typeof logger.error).toBe('function');
	expect(typeof logger.fatal).toBe('function');
});

test('redact config scrubs sensitive keys', () => {
	const chunks: string[] = [];
	const sink = {
		write(line: string) {
			chunks.push(line);
		}
	};
	const redacting = pino(
		{
			redact: {
				paths: ['password', 'client_secret', 'cancel_token', '*.password'],
				censor: '[REDACTED]'
			}
		},
		sink
	);
	redacting.info(
		{
			password: 'hunter2-secret-value',
			client_secret: 'cs-xyz-789',
			cancel_token: 'ct-abc-123',
			nested: { password: 'nested-pw-456' }
		},
		'boot'
	);
	const out = chunks.join('');
	expect(out).not.toContain('hunter2-secret-value');
	expect(out).not.toContain('cs-xyz-789');
	expect(out).not.toContain('ct-abc-123');
	expect(out).not.toContain('nested-pw-456');
	expect(out).toContain('[REDACTED]');
});
