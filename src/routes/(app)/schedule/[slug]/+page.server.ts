import { error, fail, redirect } from '@sveltejs/kit';
import { Temporal } from '@js-temporal/polyfill';
import { computeSlots } from '$lib/server/availability';
import { loadAppointmentBlocks } from '$lib/server/availability/db-blocks';
import { resolveKnobsFor } from '$lib/server/availability/knobs';
import { systemClock } from '$lib/server/clock';
import type { Location } from '$lib/server/config/schema';
import { logger } from '$lib/server/logger';
import { getConfig, getDb } from '$lib/server/state';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const cfg = getConfig();
	const eventType = cfg.event_types.find((e) => e.slug === params.slug);
	if (!eventType) error(404, `No event type with slug "${params.slug}"`);

	const knobs = resolveKnobsFor(cfg, eventType);
	const userTz = cfg.user.timezone;
	const nowInstant = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
	const rangeEnd = nowInstant.add({ hours: 24 * knobs.maximum_lookahead });

	const blocks = await loadAppointmentBlocks(getDb(), eventType.id, nowInstant, rangeEnd, userTz);
	const slots = computeSlots({
		knobs,
		rangeStart: nowInstant,
		rangeEnd,
		userTz,
		now: nowInstant,
		existingAppointments: blocks.appointments,
		remoteBusy: [],
		perDayCount: blocks.perDayCount
	});

	const slotsByDate: Record<string, string[]> = {};
	for (const s of slots) {
		const date = s.toZonedDateTimeISO(userTz).toPlainDate().toString();
		(slotsByDate[date] ??= []).push(s.toString());
	}

	const requestedSlot = url.searchParams.get('slot');
	const selectedSlot =
		requestedSlot && slots.some((s) => s.toString() === requestedSlot) ? requestedSlot : null;

	return {
		eventType: {
			id: eventType.id,
			name: eventType.name,
			slug: eventType.slug,
			duration: eventType.duration,
			description: eventType.description ?? null,
			visibility: eventType.visibility ?? 'public',
			booking_flow: eventType.booking_flow,
			location: eventType.location ?? null
		},
		user: {
			name: cfg.user.name,
			timezone: cfg.user.timezone,
			branding: cfg.user.branding ?? null
		},
		slotsByDate,
		selectedSlot
	};
};

export const actions: Actions = {
	book: async ({ request, params }) => {
		const cfg = getConfig();
		const eventType = cfg.event_types.find((e) => e.slug === params.slug);
		if (!eventType) error(404);

		const form = await request.formData();
		const slotStr = String(form.get('slot') ?? '');
		const name = String(form.get('name') ?? '').trim();
		const email = String(form.get('email') ?? '').trim();
		const notes = String(form.get('notes') ?? '').trim();
		const locationInput = form.get('location');

		if (!slotStr || !name || !email) {
			return fail(400, { error: 'Name, email, and slot are required.' });
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return fail(400, { error: 'That email address looks invalid.' });
		}

		const resolved = resolveLocation(eventType.location ?? null, locationInput);
		if (resolved !== null && typeof resolved === 'object' && 'fail' in resolved) {
			return fail(400, { error: resolved.fail });
		}
		const resolvedLocation: string | null = resolved;

		// Re-validate the slot is currently available.
		const knobs = resolveKnobsFor(cfg, eventType);
		const userTz = cfg.user.timezone;
		const nowInstant = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
		const rangeEnd = nowInstant.add({ hours: 24 * knobs.maximum_lookahead });
		const blocks = await loadAppointmentBlocks(getDb(), eventType.id, nowInstant, rangeEnd, userTz);
		const slots = computeSlots({
			knobs,
			rangeStart: nowInstant,
			rangeEnd,
			userTz,
			now: nowInstant,
			existingAppointments: blocks.appointments,
			remoteBusy: [],
			perDayCount: blocks.perDayCount
		});
		if (!slots.some((s) => s.toString() === slotStr)) {
			return fail(409, { error: 'That time is no longer available. Please pick another.' });
		}

		const start = Temporal.Instant.from(slotStr);
		const end = start.add({ minutes: eventType.duration });
		const id = crypto.randomUUID();
		const cancelToken = crypto.randomUUID();
		const status = eventType.booking_flow === 'requires_confirmation' ? 'pending' : 'confirmed';
		const responseToken =
			eventType.booking_flow === 'requires_confirmation' ? crypto.randomUUID() : null;

		try {
			await getDb()
				.insertInto('appointments')
				.values({
					id,
					event_type_id: eventType.id,
					start_time: start.toString(),
					end_time: end.toString(),
					attendee_name: name,
					attendee_email: email,
					attendee_notes: notes || null,
					location: resolvedLocation,
					status,
					cancel_token: cancelToken,
					response_token: responseToken,
					external_event_id: null,
					external_calendar_id: null,
					notification_status: null
				})
				.execute();
		} catch (err) {
			if (isUniqueViolation(err)) {
				return fail(409, { error: 'That time was just taken. Please pick another.' });
			}
			logger.error({ err, eventTypeId: eventType.id, slot: slotStr }, 'failed to insert booking');
			return fail(500, { error: 'Could not save the booking. Please try again.' });
		}

		redirect(303, `/booked/${id}?token=${encodeURIComponent(cancelToken)}`);
	}
};

type LocationResult = string | null | { fail: string };

function resolveLocation(loc: Location | null, input: FormDataEntryValue | null): LocationResult {
	if (!loc) return null;
	if (loc.mode === 'fixed') return loc.fixed;
	const submitted = typeof input === 'string' ? input.trim() : '';
	if (loc.mode === 'guest_proposes') {
		if (!submitted) return { fail: 'Please enter a meeting location.' };
		return submitted;
	}
	if (!loc.choices.includes(submitted)) {
		return { fail: 'Pick a valid location option.' };
	}
	return submitted;
}

function isUniqueViolation(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const msg = String((err as { message?: unknown }).message ?? '');
	return /UNIQUE constraint failed/i.test(msg);
}
