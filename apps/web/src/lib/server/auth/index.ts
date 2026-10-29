import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { betterAuth, type BetterAuthOptions } from 'better-auth/minimal';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { WhenConfiguration } from '@when/config';
import { logger } from '../logger';
import { buildAuthOptions } from './providers';
import { requireAuthSecret } from './secret';

export { requireAuthSecret } from './secret';

const WEEK_SECONDS = 7 * 24 * 60 * 60;

export interface WhenSession {
	user?: { name: string; email: string; image?: string | null };
	expires: string;
}

let instance: ReturnType<typeof betterAuth> | null = null;

export function makeAuth(cfg: WhenConfiguration) {
	instance = betterAuth<BetterAuthOptions>({
		secret: requireAuthSecret(),
		baseURL: cfg.url.app.replace(/\/+$/, ''),
		basePath: '/auth',
		telemetry: { enabled: false },
		session: {
			expiresIn: WEEK_SECONDS,
			disableSessionRefresh: true,
			cookieCache: { refreshCache: false }
		},
		account: {
			storeAccountCookie: false,
			accountLinking: { enabled: false }
		},
		advanced: {
			disableOriginCheck: false,
			ipAddress: { ipAddressHeaders: ['x-real-ip'] }
		},
		...buildAuthOptions(cfg),
		logger: {
			// Library messages/arguments can contain credentials, codes or tokens.
			log: (level) => logger[level]({ source: 'better-auth' }, 'authentication event')
		}
	});
	return instance;
}

export function getAuth() {
	if (!instance) throw new Error('auth not initialized — bootApp() must run first');
	return instance;
}

export const authHandle: Handle = async ({ event, resolve }) => {
	if (building) {
		event.locals.auth = async () => null;
		return resolve(event);
	}

	const auth = getAuth();

	async function readSession(): Promise<WhenSession | null> {
		const data = await auth.api.getSession({ headers: event.request.headers });
		if (!data) return null;
		return {
			user: { name: data.user.name, email: data.user.email, image: data.user.image },
			expires: data.session.expiresAt.toISOString()
		};
	}

	let session: Promise<WhenSession | null> | undefined;
	event.locals.auth = () => {
		if (!session) session = readSession();
		return session;
	};

	return svelteKitHandler({ event, resolve, auth, building });
};
