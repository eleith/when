import { dev } from '$app/environment';
import { getConfig } from '$lib/server/state';
import {
	exchangeGoogleConnect,
	findGoogleProvider,
	refreshTokenEnvVar
} from '$lib/server/providers/google-connect';
import {
	STATE_COOKIE,
	parseOAuthState,
	stateCookieOptions
} from '$lib/server/providers/state-cookie';
import type { PageServerLoad } from './$types';

function failed(service: string | null, error: string) {
	return { service, envVar: null, refreshToken: null, error };
}

export const load: PageServerLoad = async ({ url, cookies, setHeaders }) => {
	// Renders a live credential; never cache it.
	setHeaders({ 'cache-control': 'no-store' });

	const pending = parseOAuthState(cookies.get(STATE_COOKIE));
	cookies.delete(STATE_COOKIE, stateCookieOptions(dev));

	const denied = url.searchParams.get('error');
	if (denied) return failed(pending?.service ?? null, `Google returned "${denied}".`);

	const code = url.searchParams.get('code');
	if (!code) return failed(null, 'Google sent no authorization code.');

	// The nonce proves this callback belongs to a connect we started, in this browser.
	if (!pending || pending.state !== url.searchParams.get('state')) {
		return failed(null, 'This authorization did not match a pending connection.');
	}

	const config = getConfig();
	const service = findGoogleProvider(config, pending.service);
	if (!service) return failed(pending.service, `No google service named "${pending.service}".`);

	const result = await exchangeGoogleConnect(service, code, config.url.app);
	if (!result.ok) return failed(pending.service, result.reason);

	return {
		service: pending.service,
		envVar: refreshTokenEnvVar(pending.service),
		refreshToken: result.refreshToken,
		error: null
	};
};
