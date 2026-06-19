import { error, fail, redirect } from '@sveltejs/kit';
import { Temporal } from '@js-temporal/polyfill';
import { computeSlots } from '$lib/server/availability';
import { loadAppointmentBlocks } from '$lib/server/availability/db-blocks';
import { resolveAvailabilitySettings } from '$lib/server/availability/settings';
import { getBusyIntervals } from '@when/db';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import { createAppointment } from '$lib/server/booking/create';
import { parseAndValidateBookingForm, resolveTimezone } from '$lib/server/booking/form.server';
import { bookingContext } from '$lib/server/booking/context';
import type { Actions } from './$types';

export const actions: Actions = {
	book: async ({ request, params }) => {
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

		const result = await createAppointment(bookingContext(), {
			eventType,
			start: start.toString(),
			end: end.toString(),
			attendee: {
				name,
				email,
				answers,
				timezone: resolveTimezone(form.get('timezone'), userTz)
			},
			location: resolvedLocation,
			initiator: 'organizer'
		});

		if (!result.ok) {
			return fail(409, { error: 'That time was just taken. Please pick another.' });
		}

		redirect(303, `/booked/${result.appointment.id}`);
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
