import { signOutAction } from '$lib/server/auth';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import type { WhenConfiguration } from '$lib/server/config/schema';
import type { Appointment } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

type DisplayStatus =
	| 'pending'
	| 'confirmed'
	| 'in_progress'
	| 'concluded'
	| 'cancelled'
	| 'declined';

function deriveDisplayStatus(
	row: Pick<Appointment, 'status' | 'start_time' | 'end_time'>,
	now: Date
): DisplayStatus {
	if (row.status !== 'confirmed') return row.status;
	const nowMs = now.getTime();
	if (nowMs < Date.parse(row.start_time)) return 'confirmed';
	if (nowMs < Date.parse(row.end_time)) return 'in_progress';
	return 'concluded';
}

function sanitizeConfig(cfg: WhenConfiguration): unknown {
	const s = JSON.parse(JSON.stringify(cfg));
	if ('credentials' in s.auth) s.auth.credentials.password_hash = '***';
	if ('oidc' in s.auth) s.auth.oidc.client_secret = '***';
	if (s.smtp) s.smtp.pass = '***';
	for (const cal of s.calendars) {
		if (cal.type === 'caldav') cal.password = '***';
		if (cal.type === 'google') cal.client_secret = '***';
	}
	return s;
}

export const load: PageServerLoad = async ({ locals }) => {
	const session = (await locals.auth())!;

	const cfg = getConfig();
	const rows = await getDb()
		.selectFrom('appointments')
		.selectAll()
		.orderBy('start_time', 'desc')
		.execute();

	const now = systemClock.now();
	const appointments = rows.map((r) => ({
		...r,
		event_type_name: cfg.event_types.find((e) => e.id === r.event_type_id)?.name ?? r.event_type_id,
		display_status: deriveDisplayStatus(r, now)
	}));

	return { session, appointments, config: sanitizeConfig(cfg) };
};

export const actions: Actions = {
	signout: signOutAction
};
