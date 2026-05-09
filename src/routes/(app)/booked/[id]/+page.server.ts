import { error, fail } from '@sveltejs/kit';
import { requireViewableAppointment } from '$lib/server/booking/access';
import { resolveBookingActions } from '$lib/server/booking/actions';
import { deleteAppointmentFromCalendar } from '$lib/server/calendar/push';
import { systemClock } from '$lib/server/clock';
import { mergeNotificationStatus } from '$lib/server/db/notification-status';
import { notify } from '$lib/server/notify';
import { getConfig, getDb } from '$lib/server/state';
import type { Appointment } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

type ClockStatus = 'upcoming' | 'in_progress' | 'concluded';

function computeClockStatus(
	row: Pick<Appointment, 'status' | 'start_time' | 'end_time'>,
	now: Date
): ClockStatus | null {
	if (row.status !== 'pending' && row.status !== 'confirmed') return null;
	const nowMs = now.getTime();
	if (nowMs < Date.parse(row.start_time)) return 'upcoming';
	if (nowMs < Date.parse(row.end_time)) return 'in_progress';
	return 'concluded';
}

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

	const actions = resolveBookingActions({ row, viewer: 'attendee', now, eventType });
	const clockStatus = computeClockStatus(row, now);

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
		actions,
		clockStatus,
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

		const cfg = getConfig();
		const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);
		const gate = resolveBookingActions({
			row,
			viewer: 'attendee',
			now: systemClock.now(),
			eventType
		}).cancel;
		if (!gate.allowed) {
			return fail(409, { error: 'This booking can no longer be cancelled.' });
		}

		await getDb()
			.updateTable('appointments')
			.set({ status: 'cancelled', updated_at: systemClock.now().toISOString() })
			.where('id', '=', params.id)
			.execute();

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

		const notifyResult = await notify('booking_cancelled_by_attendee', {
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
