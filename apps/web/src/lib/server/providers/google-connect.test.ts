import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations, getProviderRefreshToken, saveProviderRefreshToken } from '@when/db';
import { exchangeGoogleAuthCode, getGoogleAccessToken, revokeGoogleToken } from '@when/calendar';
import type { GoogleProvider, WhenConfiguration } from '@when/config';
import {
	completeGoogleConnect,
	consentUrl,
	disconnectGoogle,
	findGoogleProvider,
	googleRedirectUri
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
	calendars: {}
};

const config = {
	url: { app: 'https://book.example.com' },
	providers: {
		gg: service,
		dav: { type: 'caldav', url: 'https://d.example/', username: 'u', password: 'p' }
	}
} as unknown as WhenConfiguration;

let db: ReturnType<typeof openDb>;

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
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

describe('completeGoogleConnect', () => {
	function exchangeReturns(refreshToken: string) {
		vi.mocked(exchangeGoogleAuthCode).mockResolvedValue({
			access_token: 'a',
			refresh_token: refreshToken,
			expires_in: 3600
		});
	}

	test('stores the token after verifying it works', async () => {
		exchangeReturns('rt-new');

		const result = await completeGoogleConnect(
			db,
			'gg',
			service,
			'code-1',
			'https://book.example.com'
		);

		expect(result.ok).toBe(true);
		expect(getGoogleAccessToken).toHaveBeenCalled();
		expect(await getProviderRefreshToken(db, 'gg')).toBe('rt-new');
	});

	test('exchanges against the same redirect uri it consented with', async () => {
		exchangeReturns('rt-new');

		await completeGoogleConnect(db, 'gg', service, 'code-1', 'https://book.example.com');

		expect(exchangeGoogleAuthCode).toHaveBeenCalledWith(
			'cid',
			'csec',
			'code-1',
			'https://book.example.com/admin/services/google/callback'
		);
	});

	test('stores nothing when google returns no refresh token', async () => {
		exchangeReturns('');

		const result = await completeGoogleConnect(
			db,
			'gg',
			service,
			'code-1',
			'https://book.example.com'
		);

		expect(result).toMatchObject({ ok: false });
		expect(await getProviderRefreshToken(db, 'gg')).toBeNull();
	});

	test('stores nothing when the exchange fails', async () => {
		vi.mocked(exchangeGoogleAuthCode).mockRejectedValue(new Error('invalid_grant'));

		const result = await completeGoogleConnect(
			db,
			'gg',
			service,
			'bad',
			'https://book.example.com'
		);

		expect(result).toMatchObject({ ok: false, reason: 'invalid_grant' });
		expect(await getProviderRefreshToken(db, 'gg')).toBeNull();
	});

	test('stores nothing when the new token cannot mint an access token', async () => {
		exchangeReturns('rt-dud');
		vi.mocked(getGoogleAccessToken).mockRejectedValue(new Error('Google token refresh failed'));

		const result = await completeGoogleConnect(
			db,
			'gg',
			service,
			'code-1',
			'https://book.example.com'
		);

		expect(result).toMatchObject({ ok: false });
		expect(await getProviderRefreshToken(db, 'gg')).toBeNull();
	});

	test('a failed reconnect leaves the working token in place', async () => {
		await saveProviderRefreshToken(db, 'gg', 'rt-working');
		vi.mocked(exchangeGoogleAuthCode).mockRejectedValue(new Error('invalid_grant'));

		await completeGoogleConnect(db, 'gg', service, 'bad', 'https://book.example.com');

		expect(await getProviderRefreshToken(db, 'gg')).toBe('rt-working');
	});
});

describe('connecting over an existing token', () => {
	test('replaces the stored token', async () => {
		await saveProviderRefreshToken(db, 'gg', 'rt-old');
		vi.mocked(exchangeGoogleAuthCode).mockResolvedValue({
			access_token: 'a',
			refresh_token: 'rt-new',
			expires_in: 3600
		});

		await completeGoogleConnect(db, 'gg', service, 'code-1', 'https://book.example.com');

		expect(await getProviderRefreshToken(db, 'gg')).toBe('rt-new');
	});

	// The admin has no reconnect, so this is unreachable from the UI; revoking here would
	// end the grant and take the new token with it.
	test('does not revoke the token it replaces', async () => {
		await saveProviderRefreshToken(db, 'gg', 'rt-old');
		vi.mocked(exchangeGoogleAuthCode).mockResolvedValue({
			access_token: 'a',
			refresh_token: 'rt-new',
			expires_in: 3600
		});

		await completeGoogleConnect(db, 'gg', service, 'code-1', 'https://book.example.com');

		expect(revokeGoogleToken).not.toHaveBeenCalled();
	});
});

describe('disconnectGoogle', () => {
	test('revokes at google and clears the stored token', async () => {
		await saveProviderRefreshToken(db, 'gg', 'rt-1');

		expect(await disconnectGoogle(db, 'gg')).toEqual({ revoked: true });

		expect(revokeGoogleToken).toHaveBeenCalledWith('rt-1');
		expect(await getProviderRefreshToken(db, 'gg')).toBeNull();
	});

	test('clears the token even when the revoke fails', async () => {
		await saveProviderRefreshToken(db, 'gg', 'rt-1');
		vi.mocked(revokeGoogleToken).mockRejectedValue(new Error('invalid_token'));

		const result = await disconnectGoogle(db, 'gg');

		expect(result).toMatchObject({ revoked: false, reason: 'invalid_token' });
		expect(await getProviderRefreshToken(db, 'gg')).toBeNull();
	});

	test('is a no-op for a service that was never connected', async () => {
		expect(await disconnectGoogle(db, 'gg')).toEqual({ revoked: true });
		expect(revokeGoogleToken).not.toHaveBeenCalled();
	});
});
