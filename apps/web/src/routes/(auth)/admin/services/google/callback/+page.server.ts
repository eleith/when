import { dev } from '$app/environment';
import { getConfig, getDb } from '$lib/server/state';
import { completeGoogleConnect, findGoogleService } from '$lib/server/services/google-connect';
import { STATE_COOKIE, parseOAuthState, stateCookieOptions } from '../../state-cookie';
import type { PageServerLoad } from './$types';

const crumb = 'Google authorization';

export const load: PageServerLoad = async ({ url, cookies }) => {
	const pending = parseOAuthState(cookies.get(STATE_COOKIE));
	cookies.delete(STATE_COOKIE, stateCookieOptions(dev));

	const denied = url.searchParams.get('error');
	if (denied) {
		return { crumb, service: pending?.service ?? null, error: `Google returned "${denied}".` };
	}

	const code = url.searchParams.get('code');
	if (!code) return { crumb, service: null, error: 'Google sent no authorization code.' };

	// The nonce proves this callback belongs to a connect we started, in this browser.
	if (!pending || pending.state !== url.searchParams.get('state')) {
		return {
			crumb,
			service: null,
			error: 'This authorization did not match a pending connection.'
		};
	}

	const config = getConfig();
	const service = findGoogleService(config, pending.service);
	if (!service) {
		return {
			crumb,
			service: pending.service,
			error: `No google service named "${pending.service}".`
		};
	}

	const result = await completeGoogleConnect(getDb(), service, code, config.url.app);
	return result.ok
		? { crumb, service: service.name, error: null }
		: { crumb, service: service.name, error: result.reason };
};
