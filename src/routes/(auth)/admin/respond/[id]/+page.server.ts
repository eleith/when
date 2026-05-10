import { error, fail } from '@sveltejs/kit';
import { acceptAppointment } from '$lib/server/booking/accept';
import { declineAppointment } from '$lib/server/booking/decline';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import type { Actions, PageServerLoad } from './$types';

type Action = 'accept' | 'decline';

function isAction(v: unknown): v is Action {
	return v === 'accept' || v === 'decline';
}

export const load: PageServerLoad = async ({ params, url }) => {
	const action = url.searchParams.get('action');
	const token = url.searchParams.get('token');

	if (!token || !isAction(action)) {
		error(400, 'Missing or invalid parameters.');
	}

	const row = await getDb()
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', params.id)
		.executeTakeFirst();

	if (!row || row.response_token !== token) {
		error(404, 'Invalid respond link.');
	}

	const cfg = getConfig();
	const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);
	const eventTypeName = eventType?.name ?? row.event_type_id;
	const attendee = { name: row.attendee_name, email: row.attendee_email };

	if (row.status !== 'pending') {
		const already = row.status === 'confirmed' ? 'accepted' : row.status;
		return { already, action: null, attendee, eventTypeName };
	}

	return { already: null, action, attendee, eventTypeName, token };
};

export const actions: Actions = {
	default: async ({ params, request, url }) => {
		const form = await request.formData();
		const action = String(form.get('action') ?? '');
		const token = String(form.get('token') ?? '');

		if (!token || !isAction(action)) {
			return fail(400, { error: 'Missing or invalid parameters.' });
		}

		const row = await getDb()
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', params.id)
			.executeTakeFirst();

		if (!row || row.response_token !== token) {
			return fail(404, { error: 'Invalid respond link.' });
		}

		const cfg = getConfig();
		const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);
		const eventTypeName = eventType?.name ?? row.event_type_id;
		const attendee = { name: row.attendee_name, email: row.attendee_email };

		if (row.status !== 'pending') {
			const already = row.status === 'confirmed' ? 'accepted' : row.status;
			return { done: true, alreadyDecided: true, already, action, attendee, eventTypeName };
		}

		const deps = { db: getDb(), cfg, clock: systemClock };
		const result =
			action === 'accept'
				? await acceptAppointment(deps, { appointment: row, baseUrl: url.origin })
				: await declineAppointment(deps, { appointment: row });

		if (!result.ok) {
			return fail(409, { error: 'This booking is no longer pending.' });
		}

		return { done: true, alreadyDecided: false, already: null, action, attendee, eventTypeName };
	}
};
