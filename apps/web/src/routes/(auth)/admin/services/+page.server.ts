import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getConfig, getDb } from '$lib/server/state';
import { consentUrl, findGoogleService } from '$lib/server/services/google-connect';
import { listServices, probeService } from '$lib/server/services/status';
import { STATE_COOKIE, stateCookieOptions } from './state-cookie';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const config = getConfig();
	return {
		crumb: 'Services',
		services: await listServices(config, getDb())
	};
};

export const actions: Actions = {
	connect: async ({ request, cookies }) => {
		const name = String((await request.formData()).get('service') ?? '');

		const config = getConfig();
		const service = findGoogleService(config, name);
		if (!service) {
			return fail(404, { notice: { tone: 'error', text: `No google service named "${name}".` } });
		}

		const state = crypto.randomUUID();
		cookies.set(STATE_COOKIE, JSON.stringify({ state, service: name }), stateCookieOptions(dev));

		redirect(303, consentUrl(service, config.url.app, state));
	},

	test: async ({ request }) => {
		const name = String((await request.formData()).get('service') ?? '');
		const result = await probeService(getConfig(), getDb(), name);
		return {
			notice: result.ok
				? { tone: 'success', text: `${name} authenticated successfully.` }
				: { tone: 'error', text: `${name} could not authenticate — ${result.message}` }
		};
	}
};
