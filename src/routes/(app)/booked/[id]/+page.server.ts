import { error, fail } from '@sveltejs/kit';
import { requireViewableAppointment } from '$lib/server/booking/access';
import { deleteAppointmentFromCalendar } from '$lib/server/calendar/push';
import { systemClock } from '$lib/server/clock';
import { mergeNotificationStatus } from '$lib/server/db/notification-status';
import { notifyBookingCancelled } from '$lib/server/notify';
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

	const row = requireViewableAppointment(found, token, systemClock.now());

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
			? { name: eventType.name, duration: eventType.duration, slug: eventType.slug }
			: { name: row.event_type_id, duration: 0, slug: row.event_type_id },
		token
	};
};

export const actions: Actions = {
	cancel: async ({ request, params }) => {
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
		if (row.status === 'cancelled') {
			return fail(400, { error: 'Booking is already cancelled.' });
		}

		await getDb()
			.updateTable('appointments')
			.set({ status: 'cancelled', updated_at: systemClock.now().toISOString() })
			.where('id', '=', params.id)
			.execute();

		const cfg = getConfig();
		const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);
		let notif = row.notification_status;

		if (row.external_event_id && row.external_calendar_id) {
			const result = await deleteAppointmentFromCalendar(
				cfg,
				row.external_calendar_id,
				row.external_event_id
			);
			if (!result.ok) {
				notif = mergeNotificationStatus(notif, { calendar_push: 'failed' });
				await getDb()
					.updateTable('appointments')
					.set({ notification_status: notif })
					.where('id', '=', params.id)
					.execute();
			}
		}

		const notifyResult = await notifyBookingCancelled({
			cfg,
			appointment: { ...row, status: 'cancelled' },
			eventType,
			cancelUrl: ''
		});
		if (!notifyResult.ok) {
			notif = mergeNotificationStatus(notif, { email: 'failed' });
			await getDb()
				.updateTable('appointments')
				.set({ notification_status: notif })
				.where('id', '=', params.id)
				.execute();
		}

		return { cancelled: true };
	}
};
