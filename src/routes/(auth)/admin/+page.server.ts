import { getConfig, getDb } from '$lib/server/state';
import type { PageServerLoad } from './$types';

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

	return { session, csrfToken, appointments };
};
