import { error } from '@sveltejs/kit';
import { requireViewableAppointment } from '$lib/server/appointment/access';
import { systemClock } from '$lib/server/clock';
import { buildIcs } from '@when/calendar';
import { senderEmail } from '@when/config';
import { findAppointment } from '@when/db';
import { getConfig, getDb } from '$lib/server/state';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const token = url.searchParams.get('token');
	if (!token) error(404);

	const found = await findAppointment(getDb(), params.id);

	const row = requireViewableAppointment(found, token, systemClock.now());

	if (row.status !== 'confirmed') {
		error(403, 'Calendar invites are only available for confirmed appointments.');
	}

	const cfg = getConfig();
	const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);
	if (!eventType) error(404);

	const cancelUrl = `${url.origin}/appointment/${row.id}?token=${encodeURIComponent(token)}`;

	const ics = buildIcs({
		appointment: row,
		eventTypeName: eventType?.name ?? row.event_type_id,
		hostName: cfg.user.name,
		hostEmail: senderEmail(cfg),
		cancelUrl,
		method: 'REQUEST'
	});

	return new Response(ics, {
		status: 200,
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'content-disposition': `attachment; filename="${row.id}.ics"`
		}
	});
};
