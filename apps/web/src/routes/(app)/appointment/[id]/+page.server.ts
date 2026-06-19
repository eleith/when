import { error, fail, redirect } from '@sveltejs/kit';
import { requireViewableAppointment } from '$lib/server/appointment/access';
import { resolveAppointmentActions } from '$lib/server/appointment/actions';
import { buildAddToCalendarLinks } from '$lib/server/calendar-links';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import { notificationStates } from '$lib/notifications';
import {
	findAppointment,
	findChainTip,
	originId,
	isChainTerminal,
	type Appointment
} from '@when/db';
import { toPublicAppointment, toPublicEventType } from '$lib/server/appointment/sanitize';
import type { Actions, PageServerLoad } from './$types';
import { cancelAppointment } from '$lib/server/appointment/cancel';
import { appointmentContext } from '$lib/server/appointment/context';

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

export const load: PageServerLoad = async ({ params, url, locals, cookies }) => {
	const session = await locals.auth();
	const isAdmin = !!session;
	const token = url.searchParams.get('token');

	const flash = cookies.get('submitted');
	if (flash) {
		cookies.delete('submitted', { path: '/' });
	}

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

	let resolvedEventType = eventType;
	if (!resolvedEventType && isAdmin && row.event_type_snapshot) {
		try {
			resolvedEventType = JSON.parse(row.event_type_snapshot);
		} catch {
			// fallback
		}
	}

	if (!resolvedEventType) {
		error(404);
	}

	const viewer = isAdmin ? 'organizer' : 'attendee';
	let actions = resolveAppointmentActions({ row, viewer, now, eventType: resolvedEventType });
	if (!eventType) {
		actions = {
			cancel: { allowed: false, reason: 'terminal_status' },
			reschedule: { allowed: false, reason: 'terminal_status' },
			accept: { allowed: false, reason: 'terminal_status' },
			decline: { allowed: false, reason: 'terminal_status' }
		};
	}

	const clockStatus = computeClockStatus(row, now);
	const showCancelModal = url.searchParams.get('cancel') === '1';

	const tokenEnc = token ? encodeURIComponent(token) : '';
	const bookedUrl = `${url.origin}/appointment/${row.id}${tokenEnc ? `?token=${tokenEnc}` : ''}`;
	const icsUrl = `${url.origin}/appointment/${row.id}/ics${tokenEnc ? `?token=${tokenEnc}` : ''}`;

	const eventName = resolvedEventType?.name ?? row.event_type_id;
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
		if (!eventType) {
			deleteCheck = { terminal: true };
		} else {
			deleteCheck = await isChainTerminal(getDb(), row.id, now);
		}
	}

	return {
		appointment: toPublicAppointment(row, isAdmin, notifications),
		eventType: toPublicEventType(resolvedEventType, isAdmin),
		calendarLinks,
		actions,
		flash: flash ?? null,
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

		const result = await cancelAppointment(appointmentContext(), {
			appointment: row,
			initiator: 'attendee'
		});
		if (!result.ok) {
			return fail(409, { error: 'This booking can no longer be cancelled.' });
		}

		redirect(303, `/appointment/${row.id}?token=${encodeURIComponent(attendeeToken)}`);
	}
};
