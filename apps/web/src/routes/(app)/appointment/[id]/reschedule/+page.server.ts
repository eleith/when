import { error, fail, redirect } from '@sveltejs/kit';
import { Temporal } from '@js-temporal/polyfill';
import { findAppointment } from '@when/db';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import { resolveFormFields } from '@when/config';
import { loadAvailability } from '$lib/server/availability/load';
import { requireViewableAppointment } from '$lib/server/booking/access';
import { classifyReschedule, rescheduleAppointment } from '$lib/server/booking/reschedule';
import { parseAndValidateBookingForm, resolveTimezone } from '$lib/server/booking/form.server';
import { bookingContext } from '$lib/server/booking/context';
import { toPublicAppointment, toPublicEventType } from '$lib/server/booking/sanitize';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const session = await locals.auth();
	const isAdmin = !!session;
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
		eventType: toPublicEventType(eventType, isAdmin, settings),
		formFields: resolveFormFields(eventType),
		slotsByDate,
		workingWindows,
		busyBlocks,
		rescheduleAppt: rescheduleError ? null : toPublicAppointment(row, isAdmin),
		rescheduleError,
		rescheduleToken: token,
		isAdmin
	};
};

export const actions: Actions = {
	book: async ({ request, params, cookies }) => {
		const form = await request.formData();
		const slotStr = String(form.get('slot') ?? '');
		const token = String(form.get('token') ?? '').trim();

		if (!slotStr) return fail(400, { error: 'Please pick a time slot.' });

		const found = await findAppointment(getDb(), params.id);
		if (!found || found.cancel_token !== token) {
			return fail(403, { error: 'Invalid reschedule token.' });
		}
		if (found.start_time === slotStr) {
			return fail(400, { error: 'Please select a new time slot.' });
		}

		const cfg = getConfig();
		const eventType = cfg.event_types.find((e) => e.id === found.event_type_id);
		if (!eventType) return fail(409, { error: 'This event type no longer exists.' });

		const parsed = parseAndValidateBookingForm(eventType, form);
		if (!parsed.ok) return fail(400, { fieldErrors: parsed.errors });
		const attendee = parsed.data;
		const timezone = resolveTimezone(form.get('timezone'), cfg.user.timezone);

		// Re-validate the slot is currently bookable, ignoring the booking's own current slot.
		const { slotsByDate } = await loadAvailability(cfg, eventType, found.start_time);
		if (!Object.values(slotsByDate).flat().includes(slotStr)) {
			return fail(409, { error: 'That time is no longer available. Please pick another.' });
		}

		const start = Temporal.Instant.from(slotStr);
		const end = start.add({ minutes: eventType.duration });
		const result = await rescheduleAppointment(bookingContext(), {
			appointment: found,
			initiator: 'attendee',
			newStart: start.toString(),
			newEnd: end.toString(),
			attendee,
			timezone
		});
		if (!result.ok) {
			if (result.reason === 'slot_taken') {
				return fail(409, { error: 'That time was just taken. Please pick another.' });
			}
			return fail(409, { error: 'This booking can no longer be rescheduled.' });
		}

		// land on the new row, not the old one
		const next = result.appointment;
		cookies.set('submitted', 'reschedule', {
			path: '/',
			maxAge: 10,
			httpOnly: true,
			sameSite: 'lax'
		});
		redirect(303, `/appointment/${next.id}?token=${encodeURIComponent(next.cancel_token)}`);
	}
};
