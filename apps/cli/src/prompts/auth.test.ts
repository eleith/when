import { describe, expect, test, vi, beforeEach } from 'vitest';
import { text, select } from '@clack/prompts';
import { promptAuth } from './auth.ts';

vi.mock('@clack/prompts', () => ({
	text: vi.fn(),
	select: vi.fn(),
	isCancel: vi.fn().mockReturnValue(false)
}));

describe('promptAuth', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	test('credentials writes an env-ref password and reports the var', async () => {
		vi.mocked(select).mockResolvedValueOnce('credentials');
		vi.mocked(text).mockResolvedValueOnce('admin'); // username

		const result = await promptAuth();

		expect(result).toEqual({
			value: { credentials: { username: 'admin', password: '${WHEN_ADMIN_PASSWORD}' } },
			envVars: ['WHEN_ADMIN_PASSWORD']
		});
	});

	test('oidc writes issuer, client id, and an env-ref secret', async () => {
		vi.mocked(select).mockResolvedValueOnce('oidc');
		vi.mocked(text)
			.mockResolvedValueOnce('https://accounts.example.com') // issuer
			.mockResolvedValueOnce('client-abc'); // client id

		const result = await promptAuth();

		expect(result).toEqual({
			value: {
				oidc: {
					issuer: 'https://accounts.example.com',
					client_id: 'client-abc',
					client_secret: '${WHEN_OIDC_CLIENT_SECRET}'
				}
			},
			envVars: ['WHEN_OIDC_CLIENT_SECRET']
		});
	});
});
