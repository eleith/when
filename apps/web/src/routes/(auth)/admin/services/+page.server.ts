import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getConfig, getDb } from '$lib/server/state';
import {
	consentUrl,
	disconnectGoogle,
	findGoogleProvider
} from '$lib/server/providers/google-connect';
import { discoverCalendars, listProviders, probeProvider } from '$lib/server/providers/status';
import { sendTestEmail, smtpSummary } from '$lib/server/email/status';
import { workerReachable } from '$lib/server/worker';
import { STATE_COOKIE, stateCookieOptions } from './state-cookie';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const config = getConfig();
	return {
		crumb: 'Services',
		providers: await listProviders(config, getDb()),
		smtp: await smtpSummary(config, getDb()),
		worker: { url: config.url.worker }
	};
};

export const actions: Actions = {
	connect: async ({ request, cookies }) => {
		const name = String((await request.formData()).get('provider') ?? '');

		const config = getConfig();
		const service = findGoogleProvider(config, name);
		if (!service) {
			return fail(404, { notice: { tone: 'error', text: `No google provider named "${name}".` } });
		}

		const state = crypto.randomUUID();
		cookies.set(STATE_COOKIE, JSON.stringify({ state, service: name }), stateCookieOptions(dev));

		redirect(303, consentUrl(service, config.url.app, state));
	},

	disconnect: async ({ request }) => {
		const name = String((await request.formData()).get('provider') ?? '');
		if (!findGoogleProvider(getConfig(), name)) {
			return fail(404, { notice: { tone: 'error', text: `No google provider named "${name}".` } });
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
		const name = String((await request.formData()).get('provider') ?? '');
		const result = await discoverCalendars(getConfig(), name);
		return result.ok
			? { discovered: { provider: name, field: result.field, calendars: result.calendars } }
			: {
					notice: { tone: 'error', text: `${name} could not list calendars — ${result.message}` }
				};
	},

	worker: async () => {
		const { worker } = getConfig().url;
		const reachable = await workerReachable(worker);
		if (reachable) return { notice: { tone: 'success', text: 'The worker is running.' } };

		return {
			notice: {
				tone: 'error',
				text: `The worker is not reachable at ${worker} — calendars stop refreshing and email stops sending.`
			}
		};
	},

	email: async ({ request }) => {
		const to = String((await request.formData()).get('to') ?? '');
		const result = await sendTestEmail(getConfig(), to);
		return {
			notice: result.ok
				? { tone: 'success', text: result.message }
				: { tone: 'error', text: `Test email failed — ${result.message}` }
		};
	},

	test: async ({ request }) => {
		const name = String((await request.formData()).get('provider') ?? '');
		const result = await probeProvider(getConfig(), name);
		return {
			notice: result.ok
				? { tone: 'success', text: `${name} authenticated successfully.` }
				: { tone: 'error', text: `${name} could not authenticate — ${result.message}` }
		};
	}
};
