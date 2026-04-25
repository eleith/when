import { error } from '@sveltejs/kit';
import { getConfig, getDb } from '$lib/server/state';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const action = url.searchParams.get('action');
	const token = url.searchParams.get('token');

	if (!token || (action !== 'accept' && action !== 'decline')) {
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

	if (row.status !== 'pending') {
		const already = row.status === 'confirmed' ? 'accepted' : row.status;
		return { already, action: null, eventTypeName: null, attendee: null };
	}

	const newStatus = action === 'accept' ? 'confirmed' : 'declined';

	await getDb()
		.updateTable('appointments')
		.set({ status: newStatus, updated_at: new Date().toISOString() })
		.where('id', '=', params.id)
		.execute();

	const cfg = getConfig();
	const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);

	return {
		action,
		attendee: {
			name: row.attendee_name,
			email: row.attendee_email
		},
		eventTypeName: eventType?.name ?? row.event_type_id
	};
};
