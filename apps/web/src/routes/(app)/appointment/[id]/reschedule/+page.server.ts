import { error, fail, redirect } from '@sveltejs/kit';
import { findAppointment } from '@when/db';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import { resolveFormFields } from '@when/config';
import { isSlotBookable, loadAvailability } from '$lib/server/availability/load';
import { requireViewableAppointment } from '$lib/server/appointment/access';
import { classifyReschedule, rescheduleAppointment } from '$lib/server/appointment/reschedule';
import {
	parseAndValidateAppointmentForm,
	resolveTimezone,
	validateReason
} from '$lib/server/appointment/form.server';
import { appointmentContext } from '$lib/server/appointment/context';
import { toPublicAppointment, toPublicEventType } from '$lib/server/appointment/sanitize';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const session = await locals.auth();
	const isAdmin = !!session;
	const token = url.searchParams.get('token');
	const now = systemClock.now();

	// 404s on a missing/expired appointment or a bad token — the cases with no event type to render.
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

		const parsed = parseAndValidateAppointmentForm(eventType, form);
		if (!parsed.ok) return fail(400, { fieldErrors: parsed.errors });
		const guest = parsed.data;
		const timezone = resolveTimezone(form.get('timezone'), cfg.user.timezone);

		const reasonResult = validateReason(form, 'rescheduling');
		if (!reasonResult.ok) return fail(400, { error: reasonResult.error });
		const reason = reasonResult.reason;

		// Re-validate the slot is currently bookable, ignoring the appointment's own current slot.
		if (!(await isSlotBookable(cfg, eventType, slotStr, found.start_time))) {
			return fail(409, { error: 'That time is no longer available. Please pick another.' });
		}

		const start = Temporal.Instant.from(slotStr);
		const end = start.add({ minutes: eventType.duration });
		const result = await rescheduleAppointment(appointmentContext(), {
			appointment: found,
			initiator: 'guest',
			newStart: start.toString(),
			newEnd: end.toString(),
			guest,
			timezone,
			reason
		});
		if (!result.ok) {
			if (result.reason === 'slot_taken') {
				return fail(409, { error: 'That time was just taken. Please pick another.' });
			}
			return fail(409, { error: 'This appointment can no longer be rescheduled.' });
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
