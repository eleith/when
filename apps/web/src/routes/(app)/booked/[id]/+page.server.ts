import { error, fail, redirect } from '@sveltejs/kit';
import { requireViewableAppointment } from '$lib/server/booking/access';
import { resolveBookingActions } from '$lib/server/booking/actions';
import { buildAddToCalendarLinks } from '$lib/server/calendar-links';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import { notificationStates } from '$lib/notifications';
import { findAppointment, findChainTip, originId, isChainTerminal, type Appointment } from '@when/db';
import type { Actions, PageServerLoad } from './$types';
import { cancelAppointment } from '$lib/server/booking/cancel';
import { bookingContext } from '$lib/server/booking/context';

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

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const session = await locals.auth();
	const isAdmin = !!session;
	const token = url.searchParams.get('token');

	const found = await findAppointment(getDb(), params.id);

	if (!found) error(404, 'Booking not found.');

	const now = systemClock.now();
	let row = found;

	if (!isAdmin) {
		if (!token) error(404);
		row = requireViewableAppointment(found, token, now);
	}

	const cfg = getConfig();
	const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);

	const viewer = isAdmin ? 'organizer' : 'attendee';
	const actions = resolveBookingActions({ row, viewer, now, eventType });
	const clockStatus = computeClockStatus(row, now);
	const showCancelModal = url.searchParams.get('cancel') === '1';

	const tokenEnc = token ? encodeURIComponent(token) : '';
	const bookedUrl = `${url.origin}/booked/${row.id}${tokenEnc ? `?token=${tokenEnc}` : ''}`;
	const icsUrl = `${url.origin}/booked/${row.id}/ics${tokenEnc ? `?token=${tokenEnc}` : ''}`;

	const eventName = eventType?.name ?? row.event_type_id;
	const calendarLinks =
		row.status === 'confirmed'
			? buildAddToCalendarLinks(
					{
						start: row.start_time,
						end: row.end_time,
						title: `${eventName} with ${cfg.user.name}`,
						description: `View or change this booking: ${bookedUrl}`,
						location: row.location ?? undefined
					},
					icsUrl
				)
			: null;

	const notifications = notificationStates(row);

	// A valid token for this row authorises its chain siblings, so we pass their tokens to the links.
	const predecessor = row.rescheduled_from_id
		? await findAppointment(getDb(), row.rescheduled_from_id)
		: null;
	const tip = row.rescheduled_to_id ? await findChainTip(getDb(), originId(row)) : null;
	const latest = tip && tip.id !== row.id ? tip : null;

	let deleteCheck = null;
	if (isAdmin) {
		deleteCheck = await isChainTerminal(getDb(), row.id, now);
	}

	return {
		appointment: {
			id: row.id,
			start_time: row.start_time,
			end_time: row.end_time,
			attendee_name: row.attendee_name,
			attendee_email: row.attendee_email,
			attendee_notes: row.attendee_notes,
			location: row.location,
			status: row.status,
			notifications,
			email_notification_status: row.email_notification_status,
			calendar_push_notification_status: row.calendar_push_notification_status
		},
		eventType: eventType
			? {
					name: eventType.name,
					duration: eventType.duration,
					slug: eventType.slug,
					description: eventType.description ?? null
				}
			: { name: row.event_type_id, duration: 0, slug: row.event_type_id, description: null },
		calendarLinks,
		actions,
		clockStatus,
		showCancelModal,
		// Admins are trusted with the attendee's cancel_token so reschedule/cancel
		// links work without a token in the URL; attendees only ever see their own.
		token: isAdmin ? (token ?? row.cancel_token) : (token ?? ''),
		isAdmin,
		organizerTz: cfg.user.timezone,
		attendeeTz: row.attendee_timezone ?? cfg.user.timezone,
		rescheduledFrom: predecessor
			? { id: predecessor.id, token: predecessor.cancel_token, start_time: predecessor.start_time }
			: null,
		latestBooking: latest ? { id: latest.id, token: latest.cancel_token } : null,
		deleteCheck
	};
};

export const actions: Actions = {
	cancel: async ({ params, request }) => {
		const row = await findAppointment(getDb(), params.id);

		if (!row) return fail(404, { error: 'Booking not found.' });

		const form = await request.formData();
		const attendeeToken = String(form.get('token') ?? '');
		if (row.cancel_token !== attendeeToken) {
			return fail(403, { error: 'Invalid cancel token.' });
		}

		const result = await cancelAppointment(bookingContext(), { appointment: row, initiator: 'attendee' });
		if (!result.ok) {
			return fail(409, { error: 'This booking can no longer be cancelled.' });
		}

		redirect(303, `/booked/${row.id}?token=${encodeURIComponent(attendeeToken)}`);
	}
};
