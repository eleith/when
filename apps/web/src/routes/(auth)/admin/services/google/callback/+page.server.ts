import { dev } from '$app/environment';
import { getConfig, getDb } from '$lib/server/state';
import { completeGoogleConnect, findGoogleProvider } from '$lib/server/providers/google-connect';
import {
	STATE_COOKIE,
	parseOAuthState,
	stateCookieOptions
} from '$lib/server/providers/state-cookie';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, cookies }) => {
	const pending = parseOAuthState(cookies.get(STATE_COOKIE));
	cookies.delete(STATE_COOKIE, stateCookieOptions(dev));

	const denied = url.searchParams.get('error');
	if (denied) {
		return { service: pending?.service ?? null, error: `Google returned "${denied}".` };
	}

	const code = url.searchParams.get('code');
	if (!code) return { service: null, error: 'Google sent no authorization code.' };

	// The nonce proves this callback belongs to a connect we started, in this browser.
	if (!pending || pending.state !== url.searchParams.get('state')) {
		return {
			service: null,
			error: 'This authorization did not match a pending connection.'
		};
	}

	const config = getConfig();
	const service = findGoogleProvider(config, pending.service);
	if (!service) {
		return {
			service: pending.service,
			error: `No google service named "${pending.service}".`
		};
	}

	const result = await completeGoogleConnect(getDb(), service, code, config.url.app);
	return result.ok
		? { service: service.name, error: null }
		: { service: service.name, error: result.reason };
};
