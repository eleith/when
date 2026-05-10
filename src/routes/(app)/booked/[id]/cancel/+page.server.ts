import { error, fail, redirect } from '@sveltejs/kit';
import { requireViewableAppointment } from '$lib/server/booking/access';
import { resolveBookingActions } from '$lib/server/booking/actions';
import { cancelAppointment } from '$lib/server/booking/cancel';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const token = url.searchParams.get('token');
	if (!token) error(404);

	const found = await getDb()
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', params.id)
		.executeTakeFirst();

	const now = systemClock.now();
	const row = requireViewableAppointment(found, token, now);

	const cfg = getConfig();
	const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);

	const gate = resolveBookingActions({ row, viewer: 'attendee', now, eventType }).cancel;
	if (!gate.allowed) {
		// Either terminal_status or past_start — nothing to confirm here. Redirect
		// to the parent view, which renders the appropriate banner.
		redirect(303, `/booked/${row.id}?token=${encodeURIComponent(token)}`);
	}

	return {
		appointment: {
			id: row.id,
			start_time: row.start_time,
			end_time: row.end_time,
			attendee_name: row.attendee_name,
			location: row.location
		},
		eventType: eventType ? { name: eventType.name } : { name: row.event_type_id },
		token
	};
};

export const actions: Actions = {
	default: async ({ params, request, url }) => {
		const form = await request.formData();
		const token = String(form.get('token') ?? '');

		const row = await getDb()
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', params.id)
			.executeTakeFirst();

		if (!row || row.cancel_token !== token) {
			return fail(403, { error: 'Invalid cancel token.' });
		}

		const result = await cancelAppointment(
			{ db: getDb(), cfg: getConfig(), clock: systemClock },
			{ appointment: row, initiator: 'attendee', baseUrl: url.origin }
		);
		if (!result.ok) {
			return fail(409, { error: 'This booking can no longer be cancelled.' });
		}

		redirect(303, `/booked/${row.id}?token=${encodeURIComponent(token)}`);
	}
};
