import { beforeEach, expect, test, vi } from 'vitest';
import { sendEmails } from './send';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
vi.mock('../smtp', () => ({ sendEmail: sendEmailMock }));

beforeEach(() => {
	sendEmailMock.mockClear();
});

test('sendEmails skips when SMTP is not configured', async () => {
	const result = await sendEmails({ ...validConfig, smtp: undefined }, [
		{ to: 'a@example.com', subject: 'test', text: 'hello' }
	]);

	expect(result).toEqual({ ok: true, skipped: true });
	expect(sendEmailMock).not.toHaveBeenCalled();
});

test('sendEmails calls sendEmail for all envelopes when SMTP is configured', async () => {
	const smtp = { host: 'smtp.example.com', port: 587, user: 'u', pass: 'p' };
	const result = await sendEmails({ ...validConfig, smtp }, [
		{ to: 'a@example.com', subject: 'test1', text: 'hello' },
		{ to: 'b@example.com', subject: 'test2', text: 'world' }
	]);

	expect(result).toEqual({ ok: true, skipped: false });
	expect(sendEmailMock).toHaveBeenCalledTimes(2);
	expect(sendEmailMock).toHaveBeenNthCalledWith(1, {
		to: 'a@example.com',
		subject: 'test1',
		text: 'hello'
	});
	expect(sendEmailMock).toHaveBeenNthCalledWith(2, {
		to: 'b@example.com',
		subject: 'test2',
		text: 'world'
	});
});
