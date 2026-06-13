import { describe, expect, test, vi } from 'vitest';
import { load, actions } from './+page.server';
import { setState, type AppState } from '$lib/server/state';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('$lib/server/auth', () => {
	return {
		signInAction: vi.fn(),
		getAuth: vi.fn()
	};
});
import { signInAction } from '$lib/server/auth';

describe('/signin server load and actions', () => {
	test('load function returns callbackUrl, authType, and errorCode', async () => {
		setState({
			config: validConfig,
			db: {} as AppState['db']
		});

		const mockLocals = {
			auth: vi.fn().mockResolvedValue(null)
		};

		const url = new URL('http://localhost/signin?callbackUrl=/custom-path&error=CredentialsSignin');
		const result = await load({
			url,
			locals: mockLocals,
			route: { id: '/signin' },
			params: {}
		} as unknown as Parameters<typeof load>[0]);

		expect(result).toEqual({
			callbackUrl: '/custom-path',
			authType: 'credentials',
			errorCode: 'CredentialsSignin'
		});
	});

	test('load function redirects if already logged in', async () => {
		setState({
			config: validConfig,
			db: {} as AppState['db']
		});

		const mockLocals = {
			auth: vi.fn().mockResolvedValue({ user: { name: 'admin' } })
		};

		const url = new URL('http://localhost/signin?callbackUrl=/custom-path');

		await expect(
			load({
				url,
				locals: mockLocals,
				route: { id: '/signin' },
				params: {}
			} as unknown as Parameters<typeof load>[0])
		).rejects.toThrow();
	});

	test('action catches AuthError and redirects back with query parameters', async () => {
		const mockError = Object.assign(new Error('CredentialsSignin'), {
			type: 'CredentialsSignin'
		});

		vi.mocked(signInAction).mockRejectedValueOnce(mockError);

		const url = new URL('http://localhost/signin?callbackUrl=/custom-path');
		const mockEvent = {
			url,
			request: {}
		};

		await expect(
			actions.default(mockEvent as unknown as Parameters<typeof actions.default>[0])
		).rejects.toThrow();
	});
});
