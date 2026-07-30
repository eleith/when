import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations, getServiceRefreshToken, saveServiceRefreshToken } from '@when/db';
import { exchangeGoogleAuthCode, getGoogleAccessToken } from '@when/calendar';
import type { GoogleService, WhenConfiguration } from '@when/config';
import {
	completeGoogleConnect,
	consentUrl,
	findGoogleService,
	googleRedirectUri,
	listGoogleServices
} from './google-connect';

vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return {
		...actual,
		exchangeGoogleAuthCode: vi.fn(),
		getGoogleAccessToken: vi.fn()
	};
});

const service: GoogleService = {
	name: 'gg',
	type: 'google',
	client_id: 'cid',
	client_secret: 'csec'
};

const config = {
	url: { app: 'https://book.example.com' },
	services: [
		service,
		{ name: 'dav', type: 'caldav', url: 'https://d.example/', username: 'u', password: 'p' }
	]
} as unknown as WhenConfiguration;

let db: ReturnType<typeof openDb>;

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	vi.mocked(exchangeGoogleAuthCode).mockReset();
	vi.mocked(getGoogleAccessToken).mockReset().mockResolvedValue('access');
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

describe('findGoogleService', () => {
	test('finds a google service by name', () => {
		expect(findGoogleService(config, 'gg')?.client_id).toBe('cid');
	});

	test('ignores a service of another type', () => {
		expect(findGoogleService(config, 'dav')).toBeNull();
	});

	test('returns null for an unknown name', () => {
		expect(findGoogleService(config, 'nope')).toBeNull();
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

describe('listGoogleServices', () => {
	test('reports an unconnected service', async () => {
		expect(await listGoogleServices(config, db)).toEqual([
			{ name: 'gg', connectedAt: null, lastError: null }
		]);
	});

	test('reports a connected service and never exposes the token', async () => {
		await saveServiceRefreshToken(db, 'gg', 'rt-1');
		const [view] = await listGoogleServices(config, db);
		expect(view.connectedAt).toBeTruthy();
		expect(JSON.stringify(view)).not.toContain('rt-1');
	});

	test('omits non-google services', async () => {
		const names = (await listGoogleServices(config, db)).map((s) => s.name);
		expect(names).toEqual(['gg']);
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

		const result = await completeGoogleConnect(db, service, 'code-1', 'https://book.example.com');

		expect(result.ok).toBe(true);
		expect(getGoogleAccessToken).toHaveBeenCalled();
		expect(await getServiceRefreshToken(db, 'gg')).toBe('rt-new');
	});

	test('exchanges against the same redirect uri it consented with', async () => {
		exchangeReturns('rt-new');

		await completeGoogleConnect(db, service, 'code-1', 'https://book.example.com');

		expect(exchangeGoogleAuthCode).toHaveBeenCalledWith(
			'cid',
			'csec',
			'code-1',
			'https://book.example.com/admin/services/google/callback'
		);
	});

	test('stores nothing when google returns no refresh token', async () => {
		exchangeReturns('');

		const result = await completeGoogleConnect(db, service, 'code-1', 'https://book.example.com');

		expect(result).toMatchObject({ ok: false });
		expect(await getServiceRefreshToken(db, 'gg')).toBeNull();
	});

	test('stores nothing when the exchange fails', async () => {
		vi.mocked(exchangeGoogleAuthCode).mockRejectedValue(new Error('invalid_grant'));

		const result = await completeGoogleConnect(db, service, 'bad', 'https://book.example.com');

		expect(result).toMatchObject({ ok: false, reason: 'invalid_grant' });
		expect(await getServiceRefreshToken(db, 'gg')).toBeNull();
	});

	test('stores nothing when the new token cannot mint an access token', async () => {
		exchangeReturns('rt-dud');
		vi.mocked(getGoogleAccessToken).mockRejectedValue(new Error('Google token refresh failed'));

		const result = await completeGoogleConnect(db, service, 'code-1', 'https://book.example.com');

		expect(result).toMatchObject({ ok: false });
		expect(await getServiceRefreshToken(db, 'gg')).toBeNull();
	});

	test('a failed reconnect leaves the working token in place', async () => {
		await saveServiceRefreshToken(db, 'gg', 'rt-working');
		vi.mocked(exchangeGoogleAuthCode).mockRejectedValue(new Error('invalid_grant'));

		await completeGoogleConnect(db, service, 'bad', 'https://book.example.com');

		expect(await getServiceRefreshToken(db, 'gg')).toBe('rt-working');
	});
});
