import { fail, redirect } from '@sveltejs/kit';
import { findAppointment } from '@when/db';
import { getConfig, getDb } from '$lib/server/state';
import { isSlotBookable } from '$lib/server/availability/load';
import { resolveDuration } from '$lib/server/appointment/duration';
import { rescheduleAppointment } from '$lib/server/appointment/reschedule';
import { validateReason } from '$lib/server/appointment/form.server';
import { appointmentContext } from '$lib/server/appointment/context';
import type { Actions } from './$types';

export const actions: Actions = {
	book: async ({ request, params }) => {
		const form = await request.formData();
		const slotStr = String(form.get('slot') ?? '');

		if (!slotStr) return fail(400, { error: 'Please pick a time slot.' });

		const found = await findAppointment(getDb(), params.id);
		if (!found) return fail(404, { error: 'Appointment not found.' });

		if (found.start_time === slotStr) {
			return fail(400, { error: 'Please select a new time slot.' });
		}

		const cfg = getConfig();
		const eventType = cfg.meetings.find((e) => e.name === found.event_type_id);
		if (!eventType) return fail(409, { error: 'This meeting type no longer exists.' });

		const reasonResult = validateReason(form, 'rescheduling');
		if (!reasonResult.ok) return fail(400, { error: reasonResult.error });
		const reason = reasonResult.reason;

		const duration = resolveDuration(eventType, form);
		if (duration === null) return fail(400, { error: 'Please pick a valid meeting length.' });

		// Re-validate the slot is currently bookable, ignoring the appointment's own current slot.
		const bookable = await isSlotBookable(cfg, eventType, slotStr, duration, found.start_time);
		if (!bookable) {
			return fail(409, { error: 'That time is no longer available. Please pick another.' });
		}

		const start = Temporal.Instant.from(slotStr);
		const end = start.add({ minutes: duration });
		const result = await rescheduleAppointment(appointmentContext(), {
			appointment: found,
			initiator: 'host', // Admin is always the host
			newStart: start.toString(),
			newEnd: end.toString(),
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
		redirect(303, `/appointment/${next.id}`);
	}
};
