import { beforeEach, expect, test, vi } from 'vitest';
import { createMailer, sendAppointmentEmail } from '../services/email.js';
import { createLogger } from '../services/logger.js';
import { sampleConfig } from '../email/__fixtures__/appointment.js';
import { emailsTotal, operationFailuresTotal } from './registry.js';

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));
const envelope = { to: 'guest@example.test', subject: 'Test', text: 'Body' };

beforeEach(() => {
	sendMail.mockReset();
	emailsTotal.reset();
	operationFailuresTotal.reset();
});

test.each([
	[{ code: 'EAUTH' }, 'auth'],
	[{ responseCode: 535 }, 'auth'],
	[{ code: 'ETIMEDOUT' }, 'timeout'],
	[{ code: 'ECONNREFUSED' }, 'connection'],
	[{ responseCode: 550 }, 'rejected'],
	[new Error('EAUTH timeout connection rejected'), 'unknown']
])('observed SMTP attempts use only structured bounded failure codes: %j', async (error, code) => {
	sendMail.mockRejectedValue(error);
	const mailer = createMailer(sampleConfig, createLogger());
	await mailer.send(envelope);
	await mailer.send(envelope);
	expect((await operationFailuresTotal.get()).values).toEqual([
		expect.objectContaining({ labels: { operation: 'smtp_send', code }, value: 2 })
	]);
	// Direct/test sends do not contribute to the legacy appointment family.
	expect((await emailsTotal.get()).values).toEqual([]);
});

test('appointment attempt scope retains recipient, kind and outcome', async () => {
	const mailer = createMailer(sampleConfig, createLogger());
	sendMail.mockRejectedValueOnce({ code: 'ETIMEDOUT' }).mockResolvedValueOnce({});
	await sendAppointmentEmail(mailer, envelope, 'guest', 'confirmed');
	await sendAppointmentEmail(mailer, envelope, 'guest', 'confirmed');
	expect((await emailsTotal.get()).values).toEqual([
		expect.objectContaining({
			labels: { recipient_type: 'guest', email_kind: 'confirmed', status: 'failure' },
			value: 1
		}),
		expect.objectContaining({
			labels: { recipient_type: 'guest', email_kind: 'confirmed', status: 'success' },
			value: 1
		})
	]);
	expect((await operationFailuresTotal.get()).values).toEqual([
		expect.objectContaining({ labels: { operation: 'smtp_send', code: 'timeout' }, value: 1 })
	]);
});
