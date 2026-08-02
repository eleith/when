import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getConfig, getDb } from '$lib/server/state';
import {
	consentUrl,
	disconnectGoogle,
	findGoogleProvider
} from '$lib/server/providers/google-connect';
import { discoverCalendars, listProviders, probeProvider } from '$lib/server/providers/status';
import { listCalendars, probeCalendar } from '$lib/server/calendar/status';
import { sendTestEmail, smtpSummary } from '$lib/server/email/status';
import { workerReachable } from '$lib/server/worker';
import { STATE_COOKIE, stateCookieOptions } from '$lib/server/providers/state-cookie';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const config = getConfig();
	return {
		crumb: 'Health',
		providers: await listProviders(config, getDb()),
		calendars: await listCalendars(config, getDb()),
		smtp: await smtpSummary(config, getDb()),
		worker: { url: config.url.worker }
	};
};

type NoticeStatus = 'up' | 'down' | 'disconnected' | 'unknown';

// Targets are namespaced: a provider and a calendar may share a name.
function notice(target: string, status: NoticeStatus, detail?: string) {
	return { notice: { for: target, status, detail } };
}

export const actions: Actions = {
	connect: async ({ request, cookies }) => {
		const name = String((await request.formData()).get('provider') ?? '');

		const config = getConfig();
		const service = findGoogleProvider(config, name);
		if (!service) {
			return fail(404, notice(`provider:${name}`, 'unknown'));
		}

		const state = crypto.randomUUID();
		cookies.set(STATE_COOKIE, JSON.stringify({ state, service: name }), stateCookieOptions(dev));

		redirect(303, consentUrl(service, config.url.app, state));
	},

	disconnect: async ({ request }) => {
		const name = String((await request.formData()).get('provider') ?? '');
		if (!findGoogleProvider(getConfig(), name)) {
			return fail(404, notice(`provider:${name}`, 'unknown'));
		}

		const result = await disconnectGoogle(getDb(), name);
		if (result.revoked) {
			return notice(`provider:${name}`, 'disconnected');
		}

		return notice(`provider:${name}`, 'disconnected', result.reason);
	},

	discover: async ({ request }) => {
		const name = String((await request.formData()).get('provider') ?? '');
		const result = await discoverCalendars(getConfig(), name);
		return result.ok
			? { discovered: { provider: name, field: result.field, calendars: result.calendars } }
			: notice(`provider:${name}`, 'down', result.message);
	},

	testCalendar: async ({ request }) => {
		const name = String((await request.formData()).get('calendar') ?? '');
		const result = await probeCalendar(getConfig(), name);
		return result.ok
			? notice(`calendar:${name}`, 'up', result.message)
			: notice(`calendar:${name}`, 'down', result.message);
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

	testProvider: async ({ request }) => {
		const name = String((await request.formData()).get('provider') ?? '');
		const result = await probeProvider(getConfig(), name);
		return result.ok
			? notice(`provider:${name}`, 'up')
			: notice(`provider:${name}`, 'down', result.message);
	}
};
