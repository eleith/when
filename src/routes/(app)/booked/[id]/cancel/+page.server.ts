import { error, fail, redirect } from '@sveltejs/kit';
import { requireViewableAppointment } from '$lib/server/booking/access';
import { resolveBookingActions } from '$lib/server/booking/actions';
import { cancelAppointment } from '$lib/server/booking/cancel';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import type { Actions } from './$types';

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
