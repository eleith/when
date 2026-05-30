import { error, fail } from '@sveltejs/kit';
import { acceptAppointment } from '$lib/server/booking/accept';
import { resolveBookingActions } from '$lib/server/booking/actions';
import { cancelAppointment } from '$lib/server/booking/cancel';
import { declineAppointment } from '$lib/server/booking/decline';
import { systemClock } from '$lib/server/clock';
import type { Appointment } from '$lib/server/db';
import { getConfig, getDb } from '$lib/server/state';
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

function isFocusAction(v: string | null): v is 'accept' | 'decline' | 'cancel' | 'reschedule' {
	return v === 'accept' || v === 'decline' || v === 'cancel' || v === 'reschedule';
}

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const session = (await locals.auth())!;

	const row = await getDb()
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', params.id)
		.executeTakeFirst();

	if (!row) error(404, 'Booking not found.');

	const cfg = getConfig();
	const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);

	const now = systemClock.now();
	const actions = resolveBookingActions({ row, viewer: 'organizer', now, eventType });
	const clockStatus = computeClockStatus(row, now);

	const focusRaw = url.searchParams.get('action');
	const focus = isFocusAction(focusRaw) ? focusRaw : null;

	return {
		session,
		appointment: {
			id: row.id,
			start_time: row.start_time,
			end_time: row.end_time,
			attendee_name: row.attendee_name,
			attendee_email: row.attendee_email,
			attendee_notes: row.attendee_notes,
			location: row.location,
			status: row.status,
			notification_status: row.notification_status
		},
		eventType: eventType
			? {
					id: eventType.id,
					name: eventType.name,
					slug: eventType.slug,
					duration: eventType.duration,
					description: eventType.description ?? null
				}
			: {
					id: row.event_type_id,
					name: row.event_type_id,
					slug: row.event_type_id,
					duration: 0,
					description: null
				},
		organizerTz: cfg.user.timezone,
		actions,
		clockStatus,
		focus,
		cancelToken: row.cancel_token,
		responseToken: row.response_token
	};
};

export const actions: Actions = {
	accept: async ({ params, url, locals }) => {
		await locals.auth();

		const row = await getDb()
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', params.id)
			.executeTakeFirst();

		if (!row) return fail(404, { error: 'Booking not found.' });

		const result = await acceptAppointment(
			{ db: getDb(), cfg: getConfig(), clock: systemClock },
			{ appointment: row, baseUrl: url.origin }
		);
		if (!result.ok) {
			return fail(409, { error: 'This booking can no longer be accepted.' });
		}
		return { success: 'accepted' };
	},

	decline: async ({ params, locals }) => {
		await locals.auth();

		const row = await getDb()
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', params.id)
			.executeTakeFirst();

		if (!row) return fail(404, { error: 'Booking not found.' });

		const result = await declineAppointment(
			{ db: getDb(), cfg: getConfig(), clock: systemClock },
			{ appointment: row }
		);
		if (!result.ok) {
			return fail(409, { error: 'This booking can no longer be declined.' });
		}
		return { success: 'declined' };
	},

	cancel: async ({ params, url, locals }) => {
		await locals.auth();

		const row = await getDb()
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', params.id)
			.executeTakeFirst();

		if (!row) return fail(404, { error: 'Booking not found.' });

		const result = await cancelAppointment(
			{ db: getDb(), cfg: getConfig(), clock: systemClock },
			{ appointment: row, initiator: 'organizer', baseUrl: url.origin }
		);
		if (!result.ok) {
			return fail(409, { error: 'This booking can no longer be cancelled.' });
		}
		return { success: 'cancelled' };
	}
};
