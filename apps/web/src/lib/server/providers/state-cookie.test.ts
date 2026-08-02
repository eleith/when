import { describe, expect, test } from 'vitest';
import { parseOAuthState, stateCookieOptions } from './state-cookie';

describe('parseOAuthState', () => {
	test('reads a well-formed cookie', () => {
		expect(parseOAuthState(JSON.stringify({ state: 'n', service: 'gg' }))).toEqual({
			state: 'n',
			service: 'gg'
		});
	});

	test('rejects a missing cookie', () => {
		expect(parseOAuthState(undefined)).toBeNull();
	});

	test('rejects malformed json', () => {
		expect(parseOAuthState('{not json')).toBeNull();
	});

	test('rejects json of the wrong shape', () => {
		expect(parseOAuthState(JSON.stringify({ state: 'n' }))).toBeNull();
		expect(parseOAuthState(JSON.stringify({ state: 1, service: 'gg' }))).toBeNull();
		expect(parseOAuthState(JSON.stringify(['n', 'gg']))).toBeNull();
	});
});

describe('stateCookieOptions', () => {
	test('is lax so the cookie survives the redirect back from google', () => {
		expect(stateCookieOptions(false).sameSite).toBe('lax');
	});

	test('is scoped to the services routes and short-lived', () => {
		const opts = stateCookieOptions(false);
		expect(opts.path).toBe('/admin');
		expect(opts.httpOnly).toBe(true);
		expect(opts.maxAge).toBe(600);
	});

	test('drops secure only in dev', () => {
		expect(stateCookieOptions(false).secure).toBe(true);
		expect(stateCookieOptions(true).secure).toBe(false);
	});
});
