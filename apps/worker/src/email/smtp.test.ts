import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import { createMailer } from './smtp.js';
import type { Logger } from '../services/logger.js';
import type { Envelope } from './recipients.js';

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
		smtp: { host: 'smtp.test', port, username: 'u', password: 'p', from: 'bookings@acme.test' }
	}) as unknown as WhenConfiguration;

const logger = { info: vi.fn(), error: vi.fn() };
const envelope: Envelope = {
	to: 'guest@example.test',
	subject: 'New appointment: chat with Booker McBookface',
	text: 'Your appointment is confirmed.',
	html: '<p>Your appointment is confirmed.</p>',
	attachments: [
		{
			filename: 'invite.ics',
			content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR',
			contentType: 'text/calendar; method=REQUEST'
		},
		{
			filename: 'logo.png',
			content: 'cG5n',
			contentType: 'image/png',
			cid: 'brand-logo',
			encoding: 'base64'
		}
	]
};

beforeEach(() => {
	vi.clearAllMocks();
});

function mailerForPort(port: number) {
	createMailer(configForPort(port), logger as unknown as Logger);
	return createTransport.mock.calls[0][0];
}

describe('smtp', () => {
	test('465 connects with implicit TLS and leaves STARTTLS alone', () => {
		expect(mailerForPort(465)).toMatchObject({ secure: true, requireTLS: false });
	});

	test.for([587, 25])('%i refuses to fall back to cleartext', (port) => {
		expect(mailerForPort(port)).toMatchObject({ secure: false, requireTLS: true });
	});

	test('forwards the rendered envelope and attachments, returning success without logging identity', async () => {
		const sendMail = vi.fn().mockResolvedValue({ accepted: [envelope.to], messageId: 'sent-id' });
		createTransport.mockReturnValueOnce({ sendMail });
		const mailer = createMailer(configForPort(587), logger as unknown as Logger);

		const result = await mailer.send(envelope);

		expect(createTransport).toHaveBeenCalledWith({
			host: 'smtp.test',
			port: 587,
			secure: false,
			requireTLS: true,
			auth: { user: 'u', pass: 'p' }
		});
		expect(sendMail).toHaveBeenCalledExactlyOnceWith({
			from: 'Jane Doe <bookings@acme.test>',
			...envelope
		});
		expect(result).toEqual({ ok: true });
		expect(logger.info).toHaveBeenCalledExactlyOnceWith('email sent');
		expect(logger.error).not.toHaveBeenCalled();
	});

	test('returns the provider failure but logs only its numeric SMTP status', async () => {
		const response = `550 5.1.1 <${envelope.to}>: Recipient address rejected`;
		const error = Object.assign(
			new Error(`Can't send mail - all recipients were rejected: ${response}`),
			{
				code: 'EENVELOPE',
				responseCode: 550,
				response,
				command: `RCPT TO:<${envelope.to}>`,
				rejected: [envelope.to]
			}
		);
		const sendMail = vi.fn().mockRejectedValue(error);
		createTransport.mockReturnValueOnce({ sendMail });
		const mailer = createMailer(configForPort(587), logger as unknown as Logger);

		const result = await mailer.send(envelope);

		expect(sendMail).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ ok: false, reason: String(error) });
		expect(logger.error).toHaveBeenCalledExactlyOnceWith({ responseCode: 550 }, 'SMTP send failed');
		expect(logger.info).not.toHaveBeenCalled();
	});

	test.each([
		{ name: 'a connection failure without SMTP status', error: new Error('connect ECONNREFUSED') },
		{
			name: 'a provider failure with private text in its status',
			error: Object.assign(new Error(`Recipient ${envelope.to} rejected`), {
				responseCode: `550 ${envelope.to}`
			})
		}
	])('logs no unsafe metadata for $name, preserving its detailed reason', async ({ error }) => {
		createTransport.mockReturnValueOnce({ sendMail: vi.fn().mockRejectedValue(error) });
		const mailer = createMailer(configForPort(587), logger as unknown as Logger);

		const result = await mailer.send(envelope);

		expect(result).toEqual({ ok: false, reason: String(error) });
		expect(logger.error).toHaveBeenCalledExactlyOnceWith(
			{ responseCode: undefined },
			'SMTP send failed'
		);
		expect(logger.info).not.toHaveBeenCalled();
	});
});
