import { sql, type Kysely } from 'kysely';
import { durationsOf } from '@when/config';
import type { Database } from '@when/db';
import { getConfig, getDb } from '$lib/server/state';
import { discoverCalendars, listProviders, probeProvider } from '$lib/server/providers/status';
import { listCalendars, probeCalendar } from '$lib/server/calendar/status';
import { sendTestEmail, smtpSummary } from '$lib/server/email/status';
import { workerReachable } from '$lib/server/worker';
import type { Actions, PageServerLoad } from './$types';

async function listBookingCounts(db: Kysely<Database>): Promise<Map<string, number>> {
	const rows = await db
		.selectFrom('appointments')
		.select(['event_type_id', sql<number>`count(*)`.as('count')])
		.where('status', '!=', 'purged')
		.groupBy('event_type_id')
		.execute();

	return new Map(rows.map((r) => [r.event_type_id, Number(r.count)]));
}

export const load: PageServerLoad = async () => {
	const config = getConfig();
	const db = getDb();

	const [providers, calendars, smtp, bookingCounts] = await Promise.all([
		listProviders(config, db),
		listCalendars(config, db),
		smtpSummary(config, db),
		listBookingCounts(db)
	]);

	const meetings = Object.entries(config.meetings).map(([slug, m]) => ({
		slug,
		title: m.title,
		visibility: m.visibility ?? 'public',
		durations: durationsOf(m).toSorted((a, b) => a - b),
		requireApproval: m.require_approval ?? true,
		bookingCalendar: m.booking_calendar,
		location: m.location ?? null,
		bookingCount: bookingCounts.get(slug) ?? 0
	}));

	return {
		providers,
		calendars,
		smtp,
		worker: { url: config.url.worker },
		meetings
	};
};

type NoticeStatus = 'up' | 'down';

// Targets are namespaced: a provider and a calendar may share a name.
function notice(target: string, status: NoticeStatus, detail?: string) {
	return { notice: { for: target, status, detail } };
}

export const actions: Actions = {
	discover: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('provider') ?? '');
		const result = await discoverCalendars(getConfig(), name);
		return { discoveryResult: { provider: name, ...result } };
	},

	testCalendar: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('calendar') ?? '');
		const result = await probeCalendar(getConfig(), name);
		return { calendarTestResult: { calendar: name, ...result } };
	},

	worker: async () => {
		const { worker } = getConfig().url;
		const reachable = await workerReachable(worker);
		if (reachable) return notice('worker', 'up');

		return notice('worker', 'down', worker);
	},

	email: async ({ request }) => {
		const form = await request.formData();
		const to = String(form.get('to') ?? '');
		const result = await sendTestEmail(getConfig(), to);
		return { emailResult: result };
	},

	testProvider: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('provider') ?? '');
		const result = await probeProvider(getConfig(), name);
		return { providerTestResult: { provider: name, ...result } };
	}
};
