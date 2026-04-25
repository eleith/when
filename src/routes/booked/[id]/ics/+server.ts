import { error } from '@sveltejs/kit';
import { buildIcs } from '$lib/server/ics';
import { getConfig, getDb } from '$lib/server/state';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
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
	const cancelUrl = `${url.origin}/booked/${row.id}?token=${encodeURIComponent(token)}`;

	const ics = buildIcs({
		appointment: row,
		eventTypeName: eventType?.name ?? row.event_type_id,
		organizerName: cfg.user.name,
		organizerEmail: cfg.user.email,
		cancelUrl
	});

	return new Response(ics, {
		status: 200,
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'content-disposition': `attachment; filename="${row.id}.ics"`
		}
	});
};
