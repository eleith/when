import { describe, expect, test, vi } from 'vitest';
import type { Handle } from '@sveltejs/kit';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('$lib/server/boot', () => ({ bootApp: async () => {} }));
vi.mock('$lib/server/appearance', () => ({ themeStyleTag: () => '' }));
vi.mock('$lib/server/state', () => ({ getConfig: () => validConfig }));
vi.mock('$lib/server/auth', () => ({
	getAuth: () => ({
		handle: (({ event, resolve }) => resolve(event)) as Handle
	})
}));

import { authGate, securityHeaders } from './hooks.server';

function event(opts: {
	routeId: string;
	method?: string;
	accept?: string;
	session?: unknown;
	path?: string;
	search?: string;
}) {
	const { routeId, method = 'GET', accept = 'text/html', session = null } = opts;
	const path = opts.path ?? '/admin/appointments';
	const search = opts.search ?? '';
	return {
		route: { id: routeId },
		request: { method, headers: new Headers({ accept }) },
		url: new URL(`http://localhost${path}${search}`),
		locals: { auth: vi.fn().mockResolvedValue(session) }
	} as unknown as Parameters<Handle>[0]['event'];
}

async function caught(fn: () => unknown): Promise<{ status: number; location?: string }> {
	try {
		await fn();
	} catch (e) {
		return e as { status: number; location?: string };
	}
	throw new Error('expected a thrown redirect/error');
}

describe('hooks auth gate', () => {
	test('lets a public route through without checking a session', async () => {
		const resolve = vi.fn(async () => new Response('ok'));
		const ev = event({ routeId: '/(app)/schedule/[slug]' });
		await authGate({ event: ev, resolve });
		expect(resolve).toHaveBeenCalledOnce();
		expect(ev.locals.auth).not.toHaveBeenCalled();
	});

	test('lets an authed request into a protected route', async () => {
		const resolve = vi.fn(async () => new Response('ok'));
		await authGate({
			event: event({ routeId: '/(auth)/admin', session: { user: { name: 'a' } } }),
			resolve
		});
		expect(resolve).toHaveBeenCalledOnce();
	});

	test('redirects an unauthed html GET to signin with a callback url', async () => {
		const resolve = vi.fn(async () => new Response('ok'));
		const r = await caught(() =>
			authGate({
				event: event({ routeId: '/(auth)/admin', path: '/admin', search: '?x=1' }),
				resolve
			})
		);
		expect(r.status).toBe(303);
		expect(r.location).toBe(`/signin?callbackUrl=${encodeURIComponent('/admin?x=1')}`);
		expect(resolve).not.toHaveBeenCalled();
	});

	test('403s an unauthed non-GET request', async () => {
		const resolve = vi.fn(async () => new Response('ok'));
		const r = await caught(() =>
			authGate({ event: event({ routeId: '/(auth)/admin', method: 'POST' }), resolve })
		);
		expect(r.status).toBe(403);
	});

	test('403s an unauthed GET that does not accept html', async () => {
		const resolve = vi.fn(async () => new Response('ok'));
		const r = await caught(() =>
			authGate({ event: event({ routeId: '/(auth)/admin', accept: 'application/json' }), resolve })
		);
		expect(r.status).toBe(403);
	});
});

describe('hooks security headers', () => {
	test.for([
		['/(app)/appointment/[id]', '/appointment/abc'],
		['/(auth)/admin', '/admin']
	])('sets them on %s', async ([routeId, path]) => {
		const resolve = vi.fn(async () => new Response('ok'));
		const response = await securityHeaders({ event: event({ routeId, path }), resolve });
		expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});
});
