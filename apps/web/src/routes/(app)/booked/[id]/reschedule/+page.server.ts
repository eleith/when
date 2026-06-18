import { error, fail, redirect } from '@sveltejs/kit';
import { Temporal } from '@js-temporal/polyfill';
import { findAppointment } from '@when/db';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import { resolveFormFields, parseAttendeeAnswers } from '@when/config';
import { loadAvailability } from '$lib/server/availability/load';
import { requireViewableAppointment } from '$lib/server/booking/access';
import { classifyReschedule, rescheduleAppointment } from '$lib/server/booking/reschedule';
import { parseAndValidateBookingForm } from '$lib/server/booking/form.server';
import { bookingContext } from '$lib/server/booking/context';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const token = url.searchParams.get('token');
	const now = systemClock.now();

	// 404s on a missing/expired booking or a bad token — the cases with no event type to render.
	const row = requireViewableAppointment(await findAppointment(getDb(), params.id), token, now);

	const cfg = getConfig();
	const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);
	if (!eventType) error(404, 'This event type no longer exists.');

	const ctx = classifyReschedule({ rescheduleId: row.id, token, existing: row, eventType, now });
	const rescheduleError = ctx.kind === 'error' ? ctx.code : null;

	const { settings, slotsByDate, workingWindows, busyBlocks } = await loadAvailability(
		cfg,
		eventType,
		row.start_time
	);

	return {
		eventType: {
			id: eventType.id,
			name: eventType.name,
			slug: eventType.slug,
			duration: eventType.duration,
			description: eventType.description ?? null,
			visibility: eventType.visibility ?? 'public',
			booking_flow: eventType.booking_flow,
			location: eventType.location ?? null,
			buffer_before: settings.buffer_before,
			buffer_after: settings.buffer_after,
			minimum_notice: settings.minimum_notice
		},
		formFields: resolveFormFields(eventType),
		slotsByDate,
		workingWindows,
		busyBlocks,
		rescheduleAppt: rescheduleError
			? null
			: {
					id: row.id,
					start_time: row.start_time,
					end_time: row.end_time,
					attendee_name: row.attendee_name,
					attendee_email: row.attendee_email,
					answers: parseAttendeeAnswers(row.attendee_answers),
					location: row.location
				},
		rescheduleError,
		rescheduleToken: token
	};
};

export const actions: Actions = {
	book: async ({ request, params, locals }) => {
		const form = await request.formData();
		const slotStr = String(form.get('slot') ?? '');
		const token = String(form.get('token') ?? '').trim();

		if (!slotStr) return fail(400, { error: 'Please pick a time slot.' });

		const session = await locals.auth();
		const initiator = session ? 'organizer' : 'attendee';

		const found = await findAppointment(getDb(), params.id);
		if (!found || (!session && found.cancel_token !== token)) {
			return fail(403, { error: 'Invalid reschedule token.' });
		}
		if (found.start_time === slotStr) {
			return fail(400, { error: 'Please select a new time slot.' });
		}

		const cfg = getConfig();
		const eventType = cfg.event_types.find((e) => e.id === found.event_type_id);
		if (!eventType) return fail(409, { error: 'This event type no longer exists.' });

		let attendee;
		if (initiator === 'attendee') {
			const parsed = parseAndValidateBookingForm(eventType, form);
			if (!parsed.ok) return fail(400, { fieldErrors: parsed.errors });
			attendee = parsed.data;
		}

		// Re-validate the slot is currently bookable, ignoring the booking's own current slot.
		const { slotsByDate } = await loadAvailability(cfg, eventType, found.start_time);
		if (!Object.values(slotsByDate).flat().includes(slotStr)) {
			return fail(409, { error: 'That time is no longer available. Please pick another.' });
		}

		const start = Temporal.Instant.from(slotStr);
		const end = start.add({ minutes: eventType.duration });
		const result = await rescheduleAppointment(bookingContext(), {
			appointment: found,
			initiator,
			newStart: start.toString(),
			newEnd: end.toString(),
			attendee
		});
		if (!result.ok) {
			if (result.reason === 'slot_taken') {
				return fail(409, { error: 'That time was just taken. Please pick another.' });
			}
			return fail(409, { error: 'This booking can no longer be rescheduled.' });
		}

		// land on the new row, not the old one
		const next = result.appointment;
		redirect(303, `/booked/${next.id}?token=${encodeURIComponent(next.cancel_token)}`);
	}
};
