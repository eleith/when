import { describe, expect, test, vi, beforeEach } from 'vitest';
import { text } from '@clack/prompts';
import { promptSmtp } from './smtp.ts';

vi.mock('@clack/prompts', () => ({
	text: vi.fn(),
	isCancel: vi.fn().mockReturnValue(false)
}));

describe('promptSmtp', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	test('writes an env-ref password and omits a blank from', async () => {
		vi.mocked(text)
			.mockResolvedValueOnce('smtp.example.com') // host
			.mockResolvedValueOnce('587') // port
			.mockResolvedValueOnce('mailer') // user
			.mockResolvedValueOnce(''); // from (blank)

		const result = await promptSmtp();

		expect(result).toEqual({
			value: { host: 'smtp.example.com', port: 587, user: 'mailer', pass: '${WHEN_SMTP_PASS}' },
			envVars: ['WHEN_SMTP_PASS']
		});
	});

	test('includes a provided from address', async () => {
		vi.mocked(text)
			.mockResolvedValueOnce('smtp.example.com') // host
			.mockResolvedValueOnce('465') // port
			.mockResolvedValueOnce('mailer') // user
			.mockResolvedValueOnce('noreply@example.com'); // from

		const result = await promptSmtp();

		expect(result?.value).toMatchObject({ port: 465, from: 'noreply@example.com' });
	});
});
