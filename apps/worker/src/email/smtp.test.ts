import { describe, expect, test, vi } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import { createMailer, isSecurePort } from './smtp.js';
import { createLogger } from '../services/logger.js';

interface TransportOptions {
	secure: boolean;
	requireTLS: boolean;
}

interface FakeTransport {
	sendMail: (message: unknown) => unknown;
}

const createTransport = vi.fn(
	(_options: TransportOptions): FakeTransport => ({
		sendMail: () => undefined
	})
);

// The factory is hoisted above createTransport, so it can only call it lazily.
vi.mock('nodemailer', () => ({
	default: { createTransport: (options: TransportOptions) => createTransport(options) }
}));

const configForPort = (port: number) =>
	({
		user: { name: 'Jane Doe', email: 'owner@acme.test' },
		smtp: { host: 'smtp.test', port, username: 'u', password: 'p' }
	}) as unknown as WhenConfiguration;

function mailerForPort(port: number) {
	createTransport.mockClear();
	createMailer(configForPort(port), createLogger());
	return createTransport.mock.calls[0][0];
}

describe('smtp', () => {
	test('465 connects with implicit TLS and leaves STARTTLS alone', () => {
		expect(mailerForPort(465)).toMatchObject({ secure: true, requireTLS: false });
	});

	test.for([587, 25])('%i refuses to fall back to cleartext', (port) => {
		expect(mailerForPort(port)).toMatchObject({ secure: false, requireTLS: true });
	});

	test('isSecurePort is true only for 465', () => {
		expect(isSecurePort(465)).toBe(true);
		expect(isSecurePort(587)).toBe(false);
		expect(isSecurePort(25)).toBe(false);
	});

	test('createMailer builds a mailer from the smtp config', () => {
		const mailer = createMailer(configForPort(587), createLogger());
		expect(typeof mailer.send).toBe('function');
	});

	test.for([true, false])('a send logs no guest identity (delivered: %s)', async (delivered) => {
		createTransport.mockReturnValueOnce({
			sendMail: () => (delivered ? undefined : Promise.reject(new Error('550 no such user')))
		});
		const logs: unknown[] = [];
		const capture = (payload: unknown) => void logs.push(payload);
		const mailer = createMailer(configForPort(587), {
			info: capture,
			error: capture
		} as unknown as Parameters<typeof createMailer>[1]);

		await mailer.send({
			to: 'guest@example.test',
			subject: 'New appointment: chat with Booker McBookface',
			text: 'body'
		});

		expect(JSON.stringify(logs)).not.toContain('guest@example.test');
		expect(JSON.stringify(logs)).not.toContain('Booker McBookface');
	});
});
