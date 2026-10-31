import { error, isHttpError } from '@sveltejs/kit';
import { isViewAllowed } from '#lib/server/appointment/access.js';
import { systemClock } from '#lib/server/clock.js';
import { buildIcs } from '@when/calendar';
import { senderEmail } from '@when/config';
import { findAppointment } from '@when/db';
import { getConfig, getDb } from '#lib/server/state.js';
import { recordIcsDownload } from '#lib/server/metrics/requests.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const token = url.searchParams.get('token');
		if (!token) {
			recordIcsDownload('not_found');
			error(404);
		}

		const row = await findAppointment(getDb(), params.id);
		if (!row || !(await isViewAllowed(getDb(), row, token, systemClock.now()))) {
			recordIcsDownload('not_found');
			error(404);
		}
		if (row.status !== 'confirmed') {
			recordIcsDownload('forbidden');
			error(403, 'Calendar invites are only available for confirmed appointments.');
		}

		const cfg = getConfig();
		const eventType = cfg.meetings[row.event_type_id];
		if (!eventType) {
			recordIcsDownload('not_found');
			error(404);
		}
		const cancelUrl = `${url.origin}/appointment/${row.id}?token=${encodeURIComponent(token)}`;
		const ics = buildIcs({
			appointment: row,
			eventTypeName: eventType?.title ?? row.event_type_id,
			hostName: cfg.user.name,
			hostEmail: senderEmail(cfg),
			cancelUrl,
			method: 'REQUEST'
		});
		const response = new Response(ics, {
			status: 200,
			headers: {
				'content-type': 'text/calendar; charset=utf-8',
				'content-disposition': `attachment; filename="${row.id}.ics"`
			}
		});
		recordIcsDownload('success');
		return response;
	} catch (err) {
		if (!isHttpError(err)) recordIcsDownload('error');
		throw err;
	}
};
