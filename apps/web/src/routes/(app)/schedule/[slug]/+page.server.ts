import { error, fail, redirect } from '@sveltejs/kit';
import { computeSlots } from '$lib/server/availability';
import { loadAppointmentBlocks } from '$lib/server/availability/db-blocks';
import { resolveAvailabilitySettings } from '$lib/server/availability/settings';
import { loadAvailability } from '$lib/server/availability/load';
import { getBusyIntervals } from '@when/db';
import { systemClock } from '$lib/server/clock';
import { logger } from '$lib/server/logger';
import { getConfig, getDb } from '$lib/server/state';
import { resolveFormFields } from '@when/config';
import { createAppointment } from '$lib/server/appointment/create';
import {
	parseAndValidateAppointmentForm,
	resolveTimezone
} from '$lib/server/appointment/form.server';
import { appointmentContext } from '$lib/server/appointment/context';
import { normalizeDeepLinkParams } from '$lib/appointment';
import { toPublicEventType } from '$lib/server/appointment/sanitize';
import { bookingAttemptsTotal } from '$lib/server/metrics';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const session = await locals.auth();
	const isAdmin = !!session;
	const cfg = getConfig();
	const eventType = cfg.meetings.find((e) => e.slug === params.slug);
	if (!eventType) error(404, `No meeting with slug "${params.slug}"`);

	// Strip malformed/unknown deep-link params up front by redirecting to the canonical URL.
	const clean = normalizeDeepLinkParams(url.searchParams);
	const expected: [string, string][] = [];
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

	const { settings, slotsByDate, workingWindows, busyBlocks } = await loadAvailability(
		cfg,
		eventType
	);

	return {
		eventType: toPublicEventType(eventType, isAdmin, settings),
		formFields: resolveFormFields(eventType),
		slotsByDate,
		workingWindows,
		busyBlocks,
		rescheduleAppt: null,
		rescheduleError: null,
		rescheduleToken: null,
		isAdmin
	};
};

export const actions: Actions = {
	book: async ({ request, params, cookies }) => {
		const cfg = getConfig();
		const eventType = cfg.meetings.find((e) => e.slug === params.slug);
		if (!eventType) error(404);

		const form = await request.formData();
		const slotStr = String(form.get('slot') ?? '');

		if (!slotStr) {
			bookingAttemptsTotal.inc({ event_type_id: eventType.name, status: 'invalid_input' });
			return fail(400, { error: 'Please pick a time slot.' });
		}

		const parsed = parseAndValidateAppointmentForm(eventType, form);
		if (!parsed.ok) {
			bookingAttemptsTotal.inc({ event_type_id: eventType.name, status: 'invalid_input' });
			return fail(400, { fieldErrors: parsed.errors });
		}
		const { name, email, answers, location: resolvedLocation } = parsed.data;

		// Re-validate the slot is currently available.
		const settings = resolveAvailabilitySettings(cfg, eventType);
		const userTz = cfg.user.timezone;
		const nowInstant = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
		const rangeEnd = nowInstant.add({ hours: 24 * settings.maximum_lookahead });

		const blocks = await loadAppointmentBlocks(getDb(), eventType.name, nowInstant, rangeEnd, userTz);
		const remoteBusy = await slotDayBusy(
			getDb(),
			eventType.busy_calendars ?? [],
			slotStr,
			userTz
		);
		const slots = computeSlots({
			settings,
			rangeStart: nowInstant,
			rangeEnd,
			userTz,
			now: nowInstant,
			existingAppointments: blocks.appointments,
			remoteBusy,
			perDayCount: blocks.perDayCount
		});
		if (!slots.some((s) => s.toString() === slotStr)) {
			bookingAttemptsTotal.inc({ event_type_id: eventType.name, status: 'slot_taken' });
			return fail(409, { error: 'That time is no longer available. Please pick another.' });
		}

		const start = Temporal.Instant.from(slotStr);
		const end = start.add({ minutes: eventType.duration_minutes });

		let created;
		try {
			created = await createAppointment(appointmentContext(), {
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
			bookingAttemptsTotal.inc({ event_type_id: eventType.name, status: 'database_error' });
			logger.error(
				{ err, eventTypeId: eventType.name, slot: slotStr },
				'failed to insert appointment'
			);
			return fail(500, { error: 'Could not save the appointment. Please try again.' });
		}
		if (!created.ok) {
			bookingAttemptsTotal.inc({ event_type_id: eventType.name, status: 'slot_taken' });
			return fail(409, { error: 'That time was just taken. Please pick another.' });
		}

		bookingAttemptsTotal.inc({ event_type_id: eventType.name, status: 'success' });

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

async function slotDayBusy(
	db: ReturnType<typeof getDb>,
	conflictCalendars: string[],
	slotStr: string,
	userTz: string
) {
	const slot = Temporal.Instant.from(slotStr);
	const date = slot.toZonedDateTimeISO(userTz).toPlainDate();
	const dayStart = date.toZonedDateTime(userTz).toInstant();
	const dayEnd = date.add({ days: 1 }).toZonedDateTime(userTz).toInstant();
	return (
		await getBusyIntervals(db, conflictCalendars, {
			start: dayStart.toString(),
			end: dayEnd.toString()
		})
	).map((b) => ({ start: Temporal.Instant.from(b.start), end: Temporal.Instant.from(b.end) }));
}
