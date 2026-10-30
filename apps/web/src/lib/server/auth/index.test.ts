import type { Handle } from '@sveltejs/kit/hooks';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parseSetCookieHeader } from 'better-auth/cookies';
import { validConfig } from '../__fixtures__/valid-config';
import { userLoginsTotal } from '../metrics';
import { authHandle, getAuth, makeAuth } from './index';

// Exercise the actual production limiter and origin checks, not test-mode defaults.
vi.hoisted(() => {
	vi.stubEnv('NODE_ENV', 'production');
	vi.stubEnv('AUTH_SECRET', 'only-a-test-secret-with-at-least-32-characters');
});

const origin = 'https://when.example.test';
const cfg = {
	...validConfig,
	auth: {
		credentials: { username: 'configured-admin', password: 'configured-admin-password' }
	},
	user: { ...validConfig.user, email: 'owner@configured.example.test' },
	url: { ...validConfig.url, app: origin }
};
const credentials = cfg.auth.credentials!;
let client = 0;
let address: string;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
	address = `192.0.2.${++client}`;
	makeAuth(cfg);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
afterAll(() => vi.unstubAllEnvs());

function event(path: string, body?: unknown, headers: Record<string, string> = {}) {
	const url = new URL(path, origin);
	return {
		url,
		request: new Request(url, {
			method: body === undefined ? 'GET' : 'POST',
			headers: {
				origin,
				'content-type': 'application/json',
				'x-real-ip': address,
				...headers
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		}),
		locals: {}
	} as Parameters<Handle>[0]['event'];
}

function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
	return authHandle({
		event: event(`/auth${path}`, body, headers),
		resolve: async () => new Response('not an auth endpoint', { status: 404 })
	});
}

function cookies(response: Response) {
	return [...parseSetCookieHeader(response.headers.get('set-cookie') ?? '')]
		.filter(([, attributes]) => attributes.value)
		.map(([name, attributes]) => `${name}=${attributes.value}`)
		.join('; ');
}

async function appSession(cookie: string) {
	const response = await authHandle({
		event: event('/admin', undefined, { cookie }),
		resolve: async (ev) => {
			const first = ev.locals.auth();
			expect(ev.locals.auth()).toBe(first);
			return Response.json(await first);
		}
	});
	return response.json();
}

test('YAML HTTP login validates credentials and protects cookie-less first login', async () => {
	const loginMetric = vi.spyOn(userLoginsTotal, 'inc');
	const bad = await request('/sign-in/credentials', { ...credentials, password: 'wrong' });
	expect(bad.status).toBe(401);
	expect((await bad.json()).code).toBe('CredentialsSignin');
	expect(cookies(bad)).toBe('');
	expect(loginMetric).toHaveBeenLastCalledWith({ provider: 'credentials', status: 'failure' });

	const crossOrigin = await request('/sign-in/credentials', credentials, {
		origin: 'https://another.example.test'
	});
	expect(crossOrigin.status).toBe(403);
	expect(cookies(crossOrigin)).toBe('');

	const good = await request('/sign-in/credentials', credentials);
	expect(good.status).toBe(200);
	expect(await good.json()).toEqual({ success: true });
	expect(loginMetric).toHaveBeenLastCalledWith({ provider: 'credentials', status: 'success' });
	expect(cookies(good)).toContain('session_data=');
	expect(cookies(good)).not.toContain(credentials.password);
	expect(cookies(good)).not.toContain('account_data=');
	expect(getAuth().options.database).toBeUndefined();
	expect(getAuth().options.secondaryStorage).toBeUndefined();
});

test('auth routes accept a configured public URL with a trailing slash', async () => {
	makeAuth({ ...cfg, url: { ...cfg.url, app: `${origin}/` } });
	const login = await request('/sign-in/credentials', credentials);
	expect(login.status).toBe(200);
	const logout = await request('/sign-out', {}, { cookie: cookies(login) });
	expect(logout.status).toBe(200);
});

test('native throttling uses the trusted X-Real-IP header', async () => {
	for (let i = 0; i < 4; i++) {
		const response = await request(
			'/sign-in/credentials',
			{ ...credentials, password: 'wrong' },
			{
				'x-forwarded-for': `198.51.100.${i + 10}`
			}
		);
		expect(response.status).toBe(i < 3 ? 401 : 429);
	}
	address = `192.0.2.${++client}`;
	expect((await request('/sign-in/credentials', credentials)).status).toBe(200);
});

test('cookies survive a fresh instance, expose only app fields and expire at the original deadline', async () => {
	const login = await request('/sign-in/credentials', credentials);
	const cookie = cookies(login);
	makeAuth(cfg); // Empty memory adapter, as after a restart.
	const session = await appSession(cookie);
	expect(session).toEqual({
		user: { name: credentials.username, email: cfg.user.email },
		expires: '2026-11-05T12:00:00.000Z'
	});

	const damaged = cookie.replace(/(session_data=.{12})/, '$1x');
	expect(await appSession(damaged)).toBeNull();
	vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
	expect(await appSession(cookie)).toEqual(session);
	vi.setSystemTime(new Date('2026-11-05T12:00:01Z'));
	expect(await appSession(cookie)).toBeNull();
});

test('bypassing the cache cannot renew the underlying session past seven days', async () => {
	const login = await request('/sign-in/credentials', credentials);
	const cookie = cookies(login);
	vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
	const response = await request('/get-session?disableCookieCache=true', undefined, { cookie });
	expect((await response.json()).session.expiresAt).toBe('2026-11-05T12:00:00.000Z');
	vi.setSystemTime(new Date('2026-11-05T12:00:01Z'));
	const expired = await request('/get-session?disableCookieCache=true', undefined, { cookie });
	expect(await expired.json()).toBeNull();
});

test('native logout clears cookies and unrelated native strategies cannot create sessions', async () => {
	const login = await request('/sign-in/credentials', credentials);
	const cookie = cookies(login);
	const logout = await request('/sign-out', {}, { cookie });
	expect(logout.status).toBe(200);
	const cleared = parseSetCookieHeader(logout.headers.get('set-cookie') ?? '');
	expect([...cleared].filter(([name]) => name.includes('session_')).length).toBeGreaterThanOrEqual(
		2
	);
	for (const [name, attributes] of cleared) {
		if (name.includes('session_')) expect(attributes.value).toBe('');
	}
	const signup = await request('/sign-up/email', {
		name: 'Someone',
		email: 'someone@example.test',
		password: 'another-password'
	});
	expect((await signup.json()).code).toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED');
	expect(cookies(signup)).toBe('');
	const passwordLogin = await request('/sign-in/email', {
		email: cfg.user.email,
		password: credentials.password
	});
	expect((await passwordLogin.json()).code).toBe('EMAIL_PASSWORD_DISABLED');
	expect(cookies(passwordLogin)).toBe('');
	const social = await request('/sign-in/social', { provider: 'oidc', callbackURL: '/admin' });
	expect(social.ok).toBe(false);
	expect(cookies(social)).not.toContain('session_data=');
});

test('OIDC uses discovery, verified tokens, PKCE, the existing callback and a global safe error return', async () => {
	const loginMetric = vi.spyOn(userLoginsTotal, 'inc');
	const issuer = 'https://idp.example.test/tenant';
	const fetch = vi.fn(async (input: RequestInfo | URL) => {
		expect(String(input)).toBe(`${issuer}/.well-known/openid-configuration`);
		return Response.json({
			issuer,
			authorization_endpoint: `${issuer}/authorize`,
			token_endpoint: `${issuer}/token`,
			userinfo_endpoint: `${issuer}/userinfo`,
			jwks_uri: `${issuer}/jwks`,
			id_token_signing_alg_values_supported: ['RS256']
		});
	});
	vi.stubGlobal('fetch', fetch);
	makeAuth({
		...cfg,
		auth: {
			oidc: {
				issuer: `${issuer}/`,
				client_id: 'configured-client',
				client_secret: 'configured-secret',
				name: 'Our SSO'
			}
		}
	});
	const auth = getAuth();
	const response = await request('/sign-in/social', { provider: 'oidc', callbackURL: '/admin' });
	expect(response.status).toBe(200);
	expect(fetch).toHaveBeenCalledOnce();
	const authorization = new URL((await response.json()).url);
	expect(authorization.origin + authorization.pathname).toBe(`${issuer}/authorize`);
	expect(authorization.searchParams.get('redirect_uri')).toBe(`${origin}/auth/callback/oidc`);
	expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
	expect(authorization.searchParams.get('nonce')).toBeTruthy();
	expect(loginMetric).not.toHaveBeenCalled();

	const oauth = auth.options.plugins?.find((plugin) => plugin.id === 'generic-oauth');
	expect(oauth?.options?.config[0]).toMatchObject({
		name: 'Our SSO',
		clientId: 'configured-client',
		clientSecret: 'configured-secret',
		requireIdTokenVerification: true,
		tokenEndpointAuth: { method: 'client_secret_basic' },
		disableProviderLogout: true
	});
	const failedCallback = await request('/callback/oidc?code=unmatched');
	expect(failedCallback.status).toBe(302);
	const location = new URL(failedCallback.headers.get('location')!, origin);
	expect(location.origin + location.pathname).toBe(`${origin}/signin`);
	const errors = location.searchParams.getAll('error');
	expect(errors).toHaveLength(1);
	expect(errors[0]).toBeTruthy();
	expect(errors[0]).not.toBe('oidc');
	expect(loginMetric).toHaveBeenLastCalledWith({ provider: 'oidc', status: 'failure' });
	expect(cookies(failedCallback)).not.toContain('session_data=');
});
