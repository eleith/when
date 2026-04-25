import { error } from '@sveltejs/kit';
import { sendEmail } from '$lib/server/smtp';
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

	const cancelUrl = `${url.origin}/booked/${row.id}?token=${encodeURIComponent(row.cancel_token)}`;

	if (action === 'accept') {
		const result = await sendEmail({
			to: row.attendee_email,
			subject: `Confirmed: ${eventType?.name ?? row.event_type_id} with ${cfg.user.name}`,
			text:
				`Your booking has been confirmed.\n\n` +
				`What: ${eventType?.name ?? row.event_type_id}\n` +
				`When: ${row.start_time}\n` +
				(row.location ? `Where: ${row.location}\n\n` : '\n') +
				`Cancel: ${cancelUrl}\n`
		});
		if (!result.ok) {
			await getDb()
				.updateTable('appointments')
				.set({
					notification_status: JSON.stringify({ email_attendee: 'failed' })
				})
				.where('id', '=', params.id)
				.execute();
		}
	} else {
		const result = await sendEmail({
			to: row.attendee_email,
			subject: `Declined: ${eventType?.name ?? row.event_type_id} with ${cfg.user.name}`,
			text:
				`Your booking request was declined.\n\n` +
				`What: ${eventType?.name ?? row.event_type_id}\n` +
				`When: ${row.start_time}\n`
		});
		if (!result.ok) {
			await getDb()
				.updateTable('appointments')
				.set({
					notification_status: JSON.stringify({ email_attendee: 'failed' })
				})
				.where('id', '=', params.id)
				.execute();
		}
	}

	return {
		action,
		attendee: {
			name: row.attendee_name,
			email: row.attendee_email
		},
		eventTypeName: eventType?.name ?? row.event_type_id
	};
};
