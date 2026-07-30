import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getConfig, getDb } from '$lib/server/state';
import {
	consentUrl,
	findGoogleService,
	googleRedirectUri,
	listGoogleServices
} from '$lib/server/services/google-connect';
import { STATE_COOKIE, stateCookieOptions } from './state-cookie';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const config = getConfig();
	return {
		crumb: 'Services',
		services: await listGoogleServices(config, getDb()),
		redirectUri: googleRedirectUri(config.url.app)
	};
};

export const actions: Actions = {
	connect: async ({ request, cookies }) => {
		const form = await request.formData();
		const name = String(form.get('service') ?? '');

		const config = getConfig();
		const service = findGoogleService(config, name);
		if (!service) return fail(404, { error: `No google service named "${name}".` });

		const state = crypto.randomUUID();
		cookies.set(STATE_COOKIE, JSON.stringify({ state, service: name }), stateCookieOptions(dev));

		redirect(303, consentUrl(service, config.url.app, state));
	}
};
