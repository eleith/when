import { error, fail, redirect } from '@sveltejs/kit';
import { requireViewableAppointment } from '$lib/server/booking/access';
import { resolveBookingActions } from '$lib/server/booking/actions';
import { buildAddToCalendarLinks } from '$lib/server/calendar-links';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import type { Appointment } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';
import { acceptAppointment } from '$lib/server/booking/accept';
import { declineAppointment } from '$lib/server/booking/decline';
import { cancelAppointment } from '$lib/server/booking/cancel';
import { parseNotificationStatus } from '$lib/server/db/notification-status';

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

	const found = await getDb()
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', params.id)
		.executeTakeFirst();

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
	const justRescheduled = url.searchParams.get('rescheduled') === '1';
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

	const notifObj = parseNotificationStatus(row.notification_status);
	const notification_failures = (Object.keys(notifObj) as Array<keyof typeof notifObj>).filter(
		(k) => notifObj[k] === 'failed'
	);

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
			notification_failures
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
		justRescheduled,
		showCancelModal,
		// Admins are trusted with the attendee's cancel_token so reschedule/cancel
		// links work without a token in the URL; attendees only ever see their own.
		token: isAdmin ? (token ?? row.cancel_token) : (token ?? ''),
		isAdmin,
		organizerTz: cfg.user.timezone
	};
};

export const actions: Actions = {
	accept: async ({ params, url, locals }) => {
		if (!(await locals.auth())) return fail(403, { error: 'Not authorized.' });

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
		if (!(await locals.auth())) return fail(403, { error: 'Not authorized.' });

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

	// Cancellation is shared by the organizer (authenticated) and the attendee
	// (token-bearing). The session decides the initiator; without one a valid
	// cancel_token is required.
	cancel: async ({ params, url, request, locals }) => {
		const session = await locals.auth();

		const row = await getDb()
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', params.id)
			.executeTakeFirst();

		if (!row) return fail(404, { error: 'Booking not found.' });

		let initiator: 'organizer' | 'attendee';
		let attendeeToken: string | null = null;
		if (session) {
			initiator = 'organizer';
		} else {
			const form = await request.formData();
			attendeeToken = String(form.get('token') ?? '');
			if (row.cancel_token !== attendeeToken) {
				return fail(403, { error: 'Invalid cancel token.' });
			}
			initiator = 'attendee';
		}

		const result = await cancelAppointment(
			{ db: getDb(), cfg: getConfig(), clock: systemClock },
			{ appointment: row, initiator, baseUrl: url.origin }
		);
		if (!result.ok) {
			return fail(409, { error: 'This booking can no longer be cancelled.' });
		}

		if (attendeeToken !== null) {
			redirect(303, `/booked/${row.id}?token=${encodeURIComponent(attendeeToken)}`);
		}
		return { success: 'cancelled' };
	}
};
