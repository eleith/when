import { redirect, error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getConfig } from '$lib/server/state';
import { consentUrl, findGoogleProvider } from '$lib/server/providers/google-connect';
import { STATE_COOKIE, stateCookieOptions } from '$lib/server/providers/state-cookie';
import type { RequestHandler } from './$types';

// POST only: a GET here would let a link prefetch mint state and bounce to Google.
export const POST: RequestHandler = async ({ request, cookies }) => {
	const name = String((await request.formData()).get('provider') ?? '');

	const config = getConfig();
	const provider = findGoogleProvider(config, name);
	if (!provider) error(404, `No google provider named "${name}".`);

	const state = crypto.randomUUID();
	cookies.set(STATE_COOKIE, JSON.stringify({ state, service: name }), stateCookieOptions(dev));

	redirect(303, consentUrl(provider, config.url.app, state));
};
