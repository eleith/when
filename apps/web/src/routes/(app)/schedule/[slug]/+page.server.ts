import { error, fail, redirect } from '@sveltejs/kit';
import { Temporal } from '@js-temporal/polyfill';
import { computeSlots } from '$lib/server/availability';
import { mergeBlocks } from '$lib/server/availability/blocks';
import { loadAppointmentBlocks } from '$lib/server/availability/db-blocks';
import { resolveKnobsFor } from '$lib/server/availability/knobs';
import { buildBaseWindows, candidateDates } from '$lib/server/availability/windows';
import { pullConflictBusy } from '@when/calendar';
import { getBusyIntervals } from '@when/db';
import { systemClock } from '$lib/server/clock';
import type { Location } from '@when/config';
import { logger } from '$lib/server/logger';
import { getConfig, getDb } from '$lib/server/state';
import { createAppointment } from '$lib/server/booking/create';
import { classifyReschedule, rescheduleAppointment } from '$lib/server/booking/reschedule';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const cfg = getConfig();
	const eventType = cfg.event_types.find((e) => e.slug === params.slug);
	if (!eventType) error(404, `No event type with slug "${params.slug}"`);

	const rescheduleId = url.searchParams.get('reschedule');
	const rescheduleToken = url.searchParams.get('token');
	let rescheduleAppt = null;
	let rescheduleError: string | null = null;

	const now = systemClock.now();

	if (rescheduleId && rescheduleToken) {
		const found = await getDb()
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', rescheduleId)
			.executeTakeFirst();
		if (!found) {
			rescheduleError = 'token';
		} else {
			const ctx = classifyReschedule({
				rescheduleId,
				token: rescheduleToken,
				existing: found,
				eventType,
				now
			});
			if (ctx.kind === 'error') {
				rescheduleError = ctx.code;
			} else if (ctx.kind === 'reschedule') {
				rescheduleAppt = {
					id: found.id,
					start_time: found.start_time,
					end_time: found.end_time,
					attendee_name: found.attendee_name,
					attendee_email: found.attendee_email,
					attendee_notes: found.attendee_notes,
					location: found.location
				};
			}
		}
	}

	const knobs = resolveKnobsFor(cfg, eventType);
	const userTz = cfg.user.timezone;
	const nowInstant = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
	const rangeEnd = nowInstant.add({ hours: 24 * knobs.maximum_lookahead });

	let blocks = await loadAppointmentBlocks(getDb(), eventType.id, nowInstant, rangeEnd, userTz);
	if (rescheduleAppt) {
		blocks = {
			appointments: blocks.appointments.filter(
				(a) => a.start.toString() !== rescheduleAppt.start_time
			),
			perDayCount: blocks.perDayCount
		};
	}

	const remoteBusy = (
		await getBusyIntervals(getDb(), eventType.conflict_calendars ?? [], {
			start: nowInstant.toString(),
			end: rangeEnd.toString()
		})
	).map((b) => ({ start: Temporal.Instant.from(b.start), end: Temporal.Instant.from(b.end) }));
	const slots = computeSlots({
		knobs,
		rangeStart: nowInstant,
		rangeEnd,
		userTz,
		now: nowInstant,
		existingAppointments: blocks.appointments,
		remoteBusy,
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

	const dates = candidateDates(nowInstant, rangeEnd, userTz);
	const workingWindows: { start: string; end: string }[] = [];
	for (const date of dates) {
		for (const w of buildBaseWindows(date, knobs.weekly, userTz)) {
			workingWindows.push({ start: w.start.toString(), end: w.end.toString() });
		}
	}
	const busyBlocks = mergeBlocks([...blocks.appointments, ...remoteBusy]).map((b) => ({
		start: b.start.toString(),
		end: b.end.toString()
	}));

	return {
		eventType: {
			id: eventType.id,
			name: eventType.name,
			slug: eventType.slug,
			duration: eventType.duration,
			description: eventType.description ?? null,
			visibility: eventType.visibility ?? 'public',
			booking_flow: eventType.booking_flow,
			location: eventType.location ?? null,
			buffer_before: knobs.buffer_before,
			buffer_after: knobs.buffer_after,
			minimum_notice: knobs.minimum_notice
		},
		slotsByDate,
		workingWindows,
		busyBlocks,
		selectedSlot,
		rescheduleAppt,
		rescheduleError,
		rescheduleToken: rescheduleToken ?? null
	};
};

export const actions: Actions = {
	book: async ({ request, params, url }) => {
		const cfg = getConfig();
		const eventType = cfg.event_types.find((e) => e.slug === params.slug);
		if (!eventType) error(404);

		const form = await request.formData();
		const slotStr = String(form.get('slot') ?? '');
		const name = String(form.get('name') ?? '').trim();
		const email = String(form.get('email') ?? '').trim();
		const notes = String(form.get('notes') ?? '').trim();
		const locationInput = form.get('location');

		const rescheduleId = String(form.get('reschedule') ?? '').trim();
		const token = String(form.get('token') ?? '').trim();

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

		let blocks = await loadAppointmentBlocks(getDb(), eventType.id, nowInstant, rangeEnd, userTz);
		let rescheduleRow = null;

		if (rescheduleId && token) {
			rescheduleRow = await getDb()
				.selectFrom('appointments')
				.selectAll()
				.where('id', '=', rescheduleId)
				.executeTakeFirst();
			if (!rescheduleRow || rescheduleRow.cancel_token !== token) {
				return fail(403, { error: 'Invalid reschedule token.' });
			}
			if (rescheduleRow.start_time === slotStr) {
				return fail(400, { error: 'Please select a new time slot.' });
			}
			blocks = {
				appointments: blocks.appointments.filter(
					(a) => a.start.toString() !== rescheduleRow!.start_time
				),
				perDayCount: blocks.perDayCount
			};
		}

		const remoteBusy = await pullSlotDayBusy(cfg, eventType, slotStr, userTz);
		const slots = computeSlots({
			knobs,
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

		if (rescheduleRow) {
			const end = start.add({ minutes: eventType.duration });
			const result = await rescheduleAppointment(
				{ db: getDb(), cfg, clock: systemClock },
				{
					appointment: rescheduleRow,
					initiator: 'attendee',
					newStart: start.toString(),
					newEnd: end.toString(),
					baseUrl: url.origin
				}
			);
			if (!result.ok) {
				if (result.reason === 'slot_taken') {
					return fail(409, { error: 'That time was just taken. Please pick another.' });
				}
				return fail(409, { error: 'This booking can no longer be rescheduled.' });
			}

			redirect(303, `/booked/${rescheduleRow.id}?token=${encodeURIComponent(token)}&rescheduled=1`);
		}
		const end = start.add({ minutes: eventType.duration });

		let created;
		try {
			created = await createAppointment(
				{ db: getDb(), cfg, clock: systemClock },
				{
					eventType,
					start: start.toString(),
					end: end.toString(),
					attendee: { name, email, notes: notes || null },
					location: resolvedLocation,
					baseUrl: url.origin
				}
			);
		} catch (err) {
			logger.error({ err, eventTypeId: eventType.id, slot: slotStr }, 'failed to insert booking');
			return fail(500, { error: 'Could not save the booking. Please try again.' });
		}
		if (!created.ok) {
			return fail(409, { error: 'That time was just taken. Please pick another.' });
		}

		redirect(
			303,
			`/booked/${created.appointment.id}?token=${encodeURIComponent(created.appointment.cancel_token)}`
		);
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

async function pullSlotDayBusy(
	cfg: ReturnType<typeof getConfig>,
	eventType: ReturnType<typeof getConfig>['event_types'][number],
	slotStr: string,
	userTz: string
) {
	const slot = Temporal.Instant.from(slotStr);
	const date = slot.toZonedDateTimeISO(userTz).toPlainDate();
	const dayStart = date.toZonedDateTime(userTz).toInstant();
	const dayEnd = date.add({ days: 1 }).toZonedDateTime(userTz).toInstant();
	return pullConflictBusy(
		cfg.calendars,
		eventType.conflict_calendars ?? [],
		{ start: dayStart, end: dayEnd },
		{ bypassCache: true }
	);
}
