import { error } from '@sveltejs/kit';
import { requireViewableAppointment } from '$lib/server/booking/access';
import { resolveBookingActions } from '$lib/server/booking/actions';
import { buildAddToCalendarLinks } from '$lib/server/calendar-links';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import type { Appointment } from '$lib/server/db';
import type { PageServerLoad } from './$types';

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
	const justRescheduled = url.searchParams.get('rescheduled') === '1';
	const showCancelModal = url.searchParams.get('cancel') === '1';

	const tokenEnc = encodeURIComponent(token);
	const bookedUrl = `${url.origin}/booked/${row.id}?token=${tokenEnc}`;
	const icsUrl = `${url.origin}/booked/${row.id}/ics?token=${tokenEnc}`;

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

	return {
		appointment: {
			id: row.id,
			start_time: row.start_time,
			end_time: row.end_time,
			attendee_name: row.attendee_name,
			attendee_email: row.attendee_email,
			attendee_notes: row.attendee_notes,
			location: row.location,
			status: row.status
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
		token
	};
};
