import { error } from '@sveltejs/kit';
import { getConfig, getDb } from '$lib/server/state';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const token = url.searchParams.get('token');
	if (!token) error(404);

	const row = await getDb()
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', params.id)
		.executeTakeFirst();

	if (!row || row.cancel_token !== token) error(404);

	const cfg = getConfig();
	const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);

	return {
		appointment: {
			id: row.id,
			start_time: row.start_time,
			end_time: row.end_time,
			attendee_name: row.attendee_name,
			attendee_email: row.attendee_email,
			location: row.location,
			status: row.status
		},
		eventType: eventType
			? { name: eventType.name, duration: eventType.duration }
			: { name: row.event_type_id, duration: 0 },
		user: { name: cfg.user.name, timezone: cfg.user.timezone },
		token
	};
};
