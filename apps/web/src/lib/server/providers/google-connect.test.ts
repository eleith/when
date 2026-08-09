import { beforeEach, describe, expect, test, vi } from 'vitest';
import { exchangeGoogleAuthCode, getGoogleAccessToken, revokeGoogleToken } from '@when/calendar';
import type { GoogleProvider, WhenConfiguration } from '@when/config';
import {
	consentUrl,
	disconnectGoogle,
	exchangeGoogleConnect,
	findGoogleProvider,
	googleRedirectUri,
	refreshTokenEnvVar
} from './google-connect';

vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return {
		...actual,
		exchangeGoogleAuthCode: vi.fn(),
		getGoogleAccessToken: vi.fn(),
		revokeGoogleToken: vi.fn()
	};
});

const service: GoogleProvider = {
	type: 'google',
	client_id: 'cid',
	client_secret: 'csec',
	refresh_token: '',
	calendars: {}
};

const config = {
	url: { app: 'https://book.example.com' },
	providers: {
		gg: service,
		dav: { type: 'caldav', url: 'https://d.example/', username: 'u', password: 'p' }
	}
} as unknown as WhenConfiguration;

beforeEach(() => {
	vi.mocked(exchangeGoogleAuthCode).mockReset();
	vi.mocked(getGoogleAccessToken).mockReset().mockResolvedValue('access');
	vi.mocked(revokeGoogleToken).mockReset().mockResolvedValue(undefined);
});

describe('redirect uri', () => {
	test('hangs the callback off the configured app url', () => {
		expect(googleRedirectUri('https://book.example.com')).toBe(
			'https://book.example.com/admin/services/google/callback'
		);
	});

	test('tolerates a trailing slash', () => {
		expect(googleRedirectUri('https://book.example.com/')).toBe(
			'https://book.example.com/admin/services/google/callback'
		);
	});
});

describe('findGoogleProvider', () => {
	test('finds a google service by name', () => {
		expect(findGoogleProvider(config, 'gg')?.client_id).toBe('cid');
	});

	test('ignores a service of another type', () => {
		expect(findGoogleProvider(config, 'dav')).toBeNull();
	});

	test('returns null for an unknown name', () => {
		expect(findGoogleProvider(config, 'nope')).toBeNull();
	});
});

describe('consentUrl', () => {
	test('carries the client, redirect and state', () => {
		const url = new URL(consentUrl(service, 'https://book.example.com', 'nonce-1'));
		expect(url.searchParams.get('client_id')).toBe('cid');
		expect(url.searchParams.get('state')).toBe('nonce-1');
		expect(url.searchParams.get('redirect_uri')).toBe(
			'https://book.example.com/admin/services/google/callback'
		);
	});
});

describe('refreshTokenEnvVar', () => {
	test('follows the documented provider env var convention', () => {
		expect(refreshTokenEnvVar('gg')).toBe('WHEN_PROVIDER_GG_REFRESH_TOKEN');
	});

	test('reads a dashed provider key as underscores', () => {
		expect(refreshTokenEnvVar('my-google-service')).toBe(
			'WHEN_PROVIDER_MY_GOOGLE_SERVICE_REFRESH_TOKEN'
		);
	});
});

describe('exchangeGoogleConnect', () => {
	function exchangeReturns(refreshToken: string) {
		vi.mocked(exchangeGoogleAuthCode).mockResolvedValue({
			access_token: 'a',
			refresh_token: refreshToken,
			expires_in: 3600
		});
	}

	test('hands back the token after verifying it works', async () => {
		exchangeReturns('rt-new');

		const result = await exchangeGoogleConnect(service, 'code-1', 'https://book.example.com');

		expect(result).toEqual({ ok: true, refreshToken: 'rt-new' });
		expect(getGoogleAccessToken).toHaveBeenCalled();
	});

	test('exchanges against the same redirect uri it consented with', async () => {
		exchangeReturns('rt-new');

		await exchangeGoogleConnect(service, 'code-1', 'https://book.example.com');

		expect(exchangeGoogleAuthCode).toHaveBeenCalledWith(
			'cid',
			'csec',
			'code-1',
			'https://book.example.com/admin/services/google/callback'
		);
	});

	test('yields no token when google returns none', async () => {
		exchangeReturns('');

		const result = await exchangeGoogleConnect(service, 'code-1', 'https://book.example.com');

		expect(result).toMatchObject({ ok: false });
	});

	test('yields no token when the exchange fails', async () => {
		vi.mocked(exchangeGoogleAuthCode).mockRejectedValue(new Error('invalid_grant'));

		const result = await exchangeGoogleConnect(service, 'bad', 'https://book.example.com');

		expect(result).toMatchObject({ ok: false, reason: 'invalid_grant' });
	});

	test('yields no token when the new one cannot mint an access token', async () => {
		exchangeReturns('rt-dud');
		vi.mocked(getGoogleAccessToken).mockRejectedValue(new Error('Google token refresh failed'));

		const result = await exchangeGoogleConnect(service, 'code-1', 'https://book.example.com');

		expect(result).toMatchObject({ ok: false });
	});
});

describe('disconnectGoogle', () => {
	const connected: GoogleProvider = { ...service, refresh_token: 'rt-1' };

	test('revokes the token when.yaml configured', async () => {
		expect(await disconnectGoogle(connected)).toEqual({ revoked: true });
		expect(revokeGoogleToken).toHaveBeenCalledWith('rt-1');
	});

	test('reports a revoke google refused', async () => {
		vi.mocked(revokeGoogleToken).mockRejectedValue(new Error('invalid_token'));

		const result = await disconnectGoogle(connected);

		expect(result).toMatchObject({ revoked: false, reason: 'invalid_token' });
	});

	test('is a no-op for a provider with no configured token', async () => {
		expect(await disconnectGoogle(service)).toEqual({ revoked: true });
		expect(revokeGoogleToken).not.toHaveBeenCalled();
	});
});
