import { error, fail, redirect } from '@sveltejs/kit';
import { Temporal } from '@js-temporal/polyfill';
import { computeSlots } from '$lib/server/availability';
import { loadAppointmentBlocks } from '$lib/server/availability/db-blocks';
import { resolveAvailabilitySettings } from '$lib/server/availability/settings';
import { loadAvailability } from '$lib/server/availability/load';
import { getBusyIntervals } from '@when/db';
import { systemClock } from '$lib/server/clock';
import { logger } from '$lib/server/logger';
import { getConfig, getDb } from '$lib/server/state';
import { resolveFormFields } from '@when/config';
import { createAppointment } from '$lib/server/booking/create';
import { parseAndValidateBookingForm, resolveTimezone } from '$lib/server/booking/form.server';
import { bookingContext } from '$lib/server/booking/context';
import { normalizeDeepLinkParams } from '$lib/booking';
import { toPublicEventType } from '$lib/server/booking/sanitize';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const session = await locals.auth();
	const isAdmin = !!session;
	const cfg = getConfig();
	const eventType = cfg.event_types.find((e) => e.slug === params.slug);
	if (!eventType) error(404, `No event type with slug "${params.slug}"`);

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
		const eventType = cfg.event_types.find((e) => e.slug === params.slug);
		if (!eventType) error(404);

		const form = await request.formData();
		const slotStr = String(form.get('slot') ?? '');

		if (!slotStr) {
			return fail(400, { error: 'Please pick a time slot.' });
		}

		const parsed = parseAndValidateBookingForm(eventType, form);
		if (!parsed.ok) {
			return fail(400, { fieldErrors: parsed.errors });
		}
		const { name, email, answers, location: resolvedLocation } = parsed.data;

		// Re-validate the slot is currently available.
		const settings = resolveAvailabilitySettings(cfg, eventType);
		const userTz = cfg.user.timezone;
		const nowInstant = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
		const rangeEnd = nowInstant.add({ hours: 24 * settings.maximum_lookahead });

		const blocks = await loadAppointmentBlocks(getDb(), eventType.id, nowInstant, rangeEnd, userTz);
		const remoteBusy = await slotDayBusy(
			getDb(),
			eventType.conflict_calendars ?? [],
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
			return fail(409, { error: 'That time is no longer available. Please pick another.' });
		}

		const start = Temporal.Instant.from(slotStr);
		const end = start.add({ minutes: eventType.duration });

		let created;
		try {
			created = await createAppointment(bookingContext(), {
				eventType,
				start: start.toString(),
				end: end.toString(),
				attendee: {
					name,
					email,
					answers,
					timezone: resolveTimezone(form.get('timezone'), cfg.user.timezone)
				},
				location: resolvedLocation,
				initiator: 'attendee'
			});
		} catch (err) {
			logger.error({ err, eventTypeId: eventType.id, slot: slotStr }, 'failed to insert booking');
			return fail(500, { error: 'Could not save the booking. Please try again.' });
		}
		if (!created.ok) {
			return fail(409, { error: 'That time was just taken. Please pick another.' });
		}

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
