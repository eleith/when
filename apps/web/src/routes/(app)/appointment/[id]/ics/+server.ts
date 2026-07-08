import { error, isHttpError } from '@sveltejs/kit';
import { requireViewableAppointment } from '$lib/server/appointment/access';
import { systemClock } from '$lib/server/clock';
import { buildIcs } from '@when/calendar';
import { senderEmail } from '@when/config';
import { findAppointment } from '@when/db';
import { getConfig, getDb } from '$lib/server/state';
import { icsDownloadsTotal } from '$lib/server/metrics';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const token = url.searchParams.get('token');
		if (!token) {
			icsDownloadsTotal.inc({ status: 'not_found' });
			error(404);
		}

		const found = await findAppointment(getDb(), params.id);

		const row = requireViewableAppointment(found, token, systemClock.now());

		if (row.status !== 'confirmed') {
			icsDownloadsTotal.inc({ status: 'forbidden' });
			error(403, 'Calendar invites are only available for confirmed appointments.');
		}

		const cfg = getConfig();
		const eventType = cfg.meetings.find((e) => e.name === row.event_type_id);
		if (!eventType) {
			icsDownloadsTotal.inc({ status: 'not_found' });
			error(404);
		}

		const cancelUrl = `${url.origin}/appointment/${row.id}?token=${encodeURIComponent(token)}`;

		const ics = buildIcs({
			appointment: row,
			eventTypeName: eventType?.name ?? row.event_type_id,
			hostName: cfg.user.name,
			hostEmail: senderEmail(cfg),
			cancelUrl,
			method: 'REQUEST'
		});

		icsDownloadsTotal.inc({ status: 'success' });
		return new Response(ics, {
			status: 200,
			headers: {
				'content-type': 'text/calendar; charset=utf-8',
				'content-disposition': `attachment; filename="${row.id}.ics"`
			}
		});
	} catch (err) {
		if (!isHttpError(err)) {
			icsDownloadsTotal.inc({ status: 'error' });
		}
		throw err;
	}
};
