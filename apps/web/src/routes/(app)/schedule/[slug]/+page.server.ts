import { error, fail, redirect } from '@sveltejs/kit';
import { isNewSlotBookable, loadAvailability } from '$lib/server/availability/booking';
import { logger } from '$lib/server/logger';
import { getConfig, getDb } from '$lib/server/state';
import { resolveFormFields } from '@when/config';
import { createAppointment } from '$lib/server/appointment/create';
import type { AppointmentRole } from '$lib/server/appointment/actions';
import { resolveBookingDurations, resolveDuration } from '$lib/server/appointment/duration';
import {
	parseAndValidateAppointmentForm,
	parseSlot,
	resolveTimezone
} from '$lib/server/appointment/form.server';
import { appointmentContext } from '$lib/server/appointment/context';
import { normalizeDeepLinkParams } from '$lib/appointment';
import { toPublicEventType } from '$lib/server/appointment/sanitize';
import { bookingAttemptsTotal } from '$lib/server/metrics';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const session = await locals.auth();
	const role: AppointmentRole = session ? 'host' : 'guest';
	const cfg = getConfig();
	const eventType = cfg.meetings[params.slug];
	if (!eventType) error(404, `No meeting with slug "${params.slug}"`);

	// Strip malformed/unknown deep-link params up front by redirecting to the canonical URL.
	const clean = normalizeDeepLinkParams(url.searchParams);
	const canonicalDurations = resolveBookingDurations(eventType, role);
	const expected: [string, string][] = [];
	if (
		clean.duration !== undefined &&
		canonicalDurations.durations.includes(clean.duration) &&
		clean.duration !== canonicalDurations.defaultDuration
	) {
		expected.push(['duration', String(clean.duration)]);
	}
	if (clean.slot) {
		expected.push(['slot', clean.slot]);
	} else if (clean.date) {
		expected.push(['date', clean.date]);
	}
	const incoming = [...url.searchParams.entries()];
	const inSync =
		incoming.length === expected.length &&
		expected.every(([k, v], i) => incoming[i]?.[0] === k && incoming[i]?.[1] === v);
	if (!inSync) {
		const query = new URLSearchParams(expected).toString();
		redirect(307, query ? `${url.pathname}?${query}` : url.pathname);
	}

	const { bookingDurations, slotsByDuration, workingWindows, busyBlocks } = await loadAvailability(
		getDb(),
		cfg,
		params.slug,
		eventType,
		role
	);

	const formAction =
		role === 'host' ? `/admin/schedule/${params.slug}` : `/schedule/${params.slug}`;
	return {
		eventType: toPublicEventType(params.slug, eventType, role, bookingDurations),
		formFields: resolveFormFields(eventType),
		formAction,
		guestFieldsDisabled: false,
		availability: { slotsByDuration, workingWindows, busyBlocks },
		reschedule: null,
		role
	};
};

export const actions: Actions = {
	default: async ({ request, params, cookies }) => {
		const cfg = getConfig();
		const eventType = cfg.meetings[params.slug];
		if (!eventType) error(404);

		const form = await request.formData();
		const slotStr = String(form.get('slot') ?? '');

		const start = parseSlot(slotStr);
		if (!start) {
			bookingAttemptsTotal.inc({ event_type_id: params.slug, status: 'invalid_input' });
			return fail(400, { error: 'Please pick a time slot.' });
		}

		const parsed = parseAndValidateAppointmentForm(eventType, form);
		if (!parsed.ok) {
			bookingAttemptsTotal.inc({ event_type_id: params.slug, status: 'invalid_input' });
			return fail(400, { fieldErrors: parsed.errors });
		}
		const { name, email, answers, location: resolvedLocation } = parsed.data;

		const duration = resolveDuration(eventType, 'guest', form);
		if (duration === null) {
			bookingAttemptsTotal.inc({ event_type_id: params.slug, status: 'invalid_input' });
			return fail(400, { error: 'Please pick a valid meeting length.' });
		}

		const bookable = await isNewSlotBookable(
			getDb(),
			cfg,
			params.slug,
			eventType,
			'guest',
			slotStr,
			duration
		);
		if (!bookable) {
			bookingAttemptsTotal.inc({ event_type_id: params.slug, status: 'slot_taken' });
			return fail(409, { error: 'That time is no longer available. Please pick another.' });
		}

		const end = start.add({ minutes: duration });

		let created;
		try {
			created = await createAppointment(appointmentContext(), {
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
				initiator: 'guest'
			});
		} catch (err) {
			bookingAttemptsTotal.inc({ event_type_id: params.slug, status: 'database_error' });
			logger.error(
				{ err, eventTypeId: params.slug, slot: slotStr },
				'failed to insert appointment'
			);
			return fail(500, { error: 'Could not save the appointment. Please try again.' });
		}
		if (!created.ok) {
			bookingAttemptsTotal.inc({ event_type_id: params.slug, status: 'slot_taken' });
			return fail(409, { error: 'That time was just taken. Please pick another.' });
		}

		bookingAttemptsTotal.inc({ event_type_id: params.slug, status: 'success' });

		cookies.set('submitted', 'request', {
			path: '/',
			maxAge: 10,
			httpOnly: true,
			sameSite: 'lax'
		});

		redirect(
			303,
			`/appointment/${created.appointment.id}?token=${encodeURIComponent(created.appointment.cancel_token)}`
		);
	}
};
