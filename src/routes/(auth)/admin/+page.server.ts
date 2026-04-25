import { getConfig, getDb } from '$lib/server/state';
import type { WhenConfiguration } from '$lib/server/config/schema';
import type { PageServerLoad } from './$types';

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

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const session = (await locals.auth())!;
	const csrfRes = await fetch('/auth/csrf');
	const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

	const cfg = getConfig();
	const rows = await getDb()
		.selectFrom('appointments')
		.selectAll()
		.orderBy('start_time', 'desc')
		.execute();

	const appointments = rows.map((r) => ({
		...r,
		event_type_name: cfg.event_types.find((e) => e.id === r.event_type_id)?.name ?? r.event_type_id
	}));

	return { session, csrfToken, appointments, config: sanitizeConfig(cfg) };
};
