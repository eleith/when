import { error, fail, redirect } from '@sveltejs/kit';
import { isNewSlotBookable } from '$lib/server/availability/booking';
import { getConfig, getDb } from '$lib/server/state';
import { createAppointment } from '$lib/server/appointment/create';
import { resolveDuration } from '$lib/server/appointment/duration';
import {
	parseAndValidateAppointmentForm,
	parseSlot,
	resolveTimezone
} from '$lib/server/appointment/form.server';
import { appointmentContext } from '$lib/server/appointment/context';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, params }) => {
		const cfg = getConfig();
		const eventType = cfg.meetings[params.slug];
		if (!eventType) error(404);

		const form = await request.formData();
		const slotStr = String(form.get('slot') ?? '');

		const start = parseSlot(slotStr);
		if (!start) {
			return fail(400, { error: 'Please pick a time slot.' });
		}

		const parsed = parseAndValidateAppointmentForm(eventType, form);
		if (!parsed.ok) {
			return fail(400, { fieldErrors: parsed.errors });
		}
		const { name, email, answers, location: resolvedLocation } = parsed.data;

		const duration = resolveDuration(eventType, form);
		if (duration === null) {
			return fail(400, { error: 'Please pick a valid meeting length.' });
		}

		const bookable = await isNewSlotBookable(
			getDb(),
			cfg,
			params.slug,
			eventType,
			'host',
			slotStr,
			duration
		);
		if (!bookable) {
			return fail(409, { error: 'That time is no longer available. Please pick another.' });
		}

		const end = start.add({ minutes: duration });

		const result = await createAppointment(appointmentContext(), {
			slug: params.slug,
			eventType,
			start: start.toString(),
			end: end.toString(),
			guest: {
				name,
				email,
				answers,
				timezone: resolveTimezone(form.get('timezone'), cfg.user.timezone)
			},
			location: resolvedLocation,
			initiator: 'host'
		});

		if (!result.ok) {
			return fail(409, { error: 'That time was just taken. Please pick another.' });
		}

		redirect(303, `/appointment/${result.appointment.id}`);
	}
};
