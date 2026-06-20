import { fail, redirect } from '@sveltejs/kit';
import { Temporal } from '@js-temporal/polyfill';
import { findAppointment } from '@when/db';
import { getConfig, getDb } from '$lib/server/state';
import { loadAvailability } from '$lib/server/availability/load';
import { rescheduleAppointment } from '$lib/server/appointment/reschedule';
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
		const eventType = cfg.event_types.find((e) => e.id === found.event_type_id);
		if (!eventType) return fail(409, { error: 'This event type no longer exists.' });

		const reason = form.get('reschedule_reason')
			? String(form.get('reschedule_reason')).trim()
			: undefined;
		if (reason && reason.length > 1000) {
			return fail(400, { error: 'Reason for rescheduling must be 1000 characters or fewer.' });
		}

		// Re-validate the slot is currently bookable, ignoring the appointment's own current slot.
		const { slotsByDate } = await loadAvailability(cfg, eventType, found.start_time);
		if (!Object.values(slotsByDate).flat().includes(slotStr)) {
			return fail(409, { error: 'That time is no longer available. Please pick another.' });
		}

		const start = Temporal.Instant.from(slotStr);
		const end = start.add({ minutes: eventType.duration });
		const result = await rescheduleAppointment(appointmentContext(), {
			appointment: found,
			initiator: 'organizer', // Admin is always the organizer
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
