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

type NoticeStatus = 'up' | 'down' | 'disconnected' | 'unknown';

function notice(target: string, status: NoticeStatus, detail?: string) {
	return { notice: { for: target, status, detail } };
}

export const actions: Actions = {
	connect: async ({ request, cookies }) => {
		const name = String((await request.formData()).get('provider') ?? '');

		const config = getConfig();
		const service = findGoogleProvider(config, name);
		if (!service) {
			return fail(404, notice(name, 'unknown'));
		}

		const state = crypto.randomUUID();
		cookies.set(STATE_COOKIE, JSON.stringify({ state, service: name }), stateCookieOptions(dev));

		redirect(303, consentUrl(service, config.url.app, state));
	},

	disconnect: async ({ request }) => {
		const name = String((await request.formData()).get('provider') ?? '');
		if (!findGoogleProvider(getConfig(), name)) {
			return fail(404, notice(name, 'unknown'));
		}

		const result = await disconnectGoogle(getDb(), name);
		if (result.revoked) {
			return notice(name, 'disconnected');
		}

		return notice(name, 'disconnected', result.reason);
	},

	calendars: async ({ request }) => {
		const name = String((await request.formData()).get('provider') ?? '');
		const result = await discoverCalendars(getConfig(), name);
		return result.ok
			? { discovered: { provider: name, field: result.field, calendars: result.calendars } }
			: notice(name, 'down', result.message);
	},

	worker: async () => {
		const { worker } = getConfig().url;
		const reachable = await workerReachable(worker);
		if (reachable) return notice('worker', 'up');

		return notice('worker', 'down', worker);
	},

	email: async ({ request }) => {
		const to = String((await request.formData()).get('to') ?? '');
		const result = await sendTestEmail(getConfig(), to);
		return result.ok ? notice('smtp', 'up', to) : notice('smtp', 'down', result.message);
	},

	test: async ({ request }) => {
		const name = String((await request.formData()).get('provider') ?? '');
		const result = await probeProvider(getConfig(), name);
		return result.ok ? notice(name, 'up') : notice(name, 'down', result.message);
	}
};
