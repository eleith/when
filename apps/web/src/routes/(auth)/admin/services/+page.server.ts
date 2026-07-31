import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getConfig, getDb } from '$lib/server/state';
import {
	consentUrl,
	disconnectGoogle,
	findGoogleService
} from '$lib/server/services/google-connect';
import { discoverCalendars, listServices, probeService } from '$lib/server/services/status';
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

	disconnect: async ({ request }) => {
		const name = String((await request.formData()).get('service') ?? '');
		if (!findGoogleService(getConfig(), name)) {
			return fail(404, { notice: { tone: 'error', text: `No google service named "${name}".` } });
		}

		const result = await disconnectGoogle(getDb(), name);
		return {
			notice: result.revoked
				? { tone: 'success', text: `${name} disconnected and access revoked at Google.` }
				: {
						tone: 'error',
						text: `${name} disconnected, but Google did not confirm the revoke — ${result.reason}. Remove access under your Google account if it persists.`
					}
		};
	},

	calendars: async ({ request }) => {
		const name = String((await request.formData()).get('service') ?? '');
		const result = await discoverCalendars(getConfig(), getDb(), name);
		return result.ok
			? { discovered: { service: name, field: result.field, calendars: result.calendars } }
			: {
					notice: { tone: 'error', text: `${name} could not list calendars — ${result.message}` }
				};
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
