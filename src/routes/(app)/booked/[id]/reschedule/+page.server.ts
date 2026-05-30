import { fail, redirect } from '@sveltejs/kit';
import { Temporal } from '@js-temporal/polyfill';
import { computeSlots } from '$lib/server/availability';
import { mergeBlocks } from '$lib/server/availability/blocks';
import { loadAppointmentBlocks } from '$lib/server/availability/db-blocks';
import { resolveKnobsFor } from '$lib/server/availability/knobs';
import { buildBaseWindows, candidateDates } from '$lib/server/availability/windows';
import { classifyReschedule, rescheduleAppointment } from '$lib/server/booking/reschedule';
import { conflictPullWindow, pullConflictBusy } from '$lib/server/calendar/conflicts';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const token = url.searchParams.get('token');
	const cfg = getConfig();

	const row = await getDb()
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', params.id)
		.executeTakeFirst();

	const eventType = row ? cfg.event_types.find((e) => e.id === row.event_type_id) : undefined;

	if (!eventType) {
		return { kind: 'error' as const, code: 'token' as const, eventSlug: null };
	}

	const now = systemClock.now();
	const ctx = classifyReschedule({
		rescheduleId: params.id,
		token,
		existing: row,
		eventType,
		now
	});

	if (ctx.kind === 'error') {
		return { kind: 'error' as const, code: ctx.code, eventSlug: eventType.slug };
	}
	if (ctx.kind === 'fresh') {
		// Defensive: classifyReschedule only returns 'fresh' when rescheduleId is null.
		// Here rescheduleId is always params.id, so this branch should be unreachable.
		return { kind: 'error' as const, code: 'token' as const, eventSlug: eventType.slug };
	}

	// Happy path. row is guaranteed defined by ctx.kind === 'reschedule'.
	const appointment = row!;

	const knobs = resolveKnobsFor(cfg, eventType);
	const userTz = cfg.user.timezone;
	const nowInstant = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
	const rangeEnd = nowInstant.add({ hours: 24 * knobs.maximum_lookahead });

	let blocks = await loadAppointmentBlocks(getDb(), eventType.id, nowInstant, rangeEnd, userTz);
	// Exclude self so the user can see their current slot (or adjacent ones) as available.
	blocks = {
		appointments: blocks.appointments.filter((a) => a.start.toString() !== appointment.start_time),
		perDayCount: blocks.perDayCount
	};
	const remoteBusy = await pullConflictBusy(
		cfg.calendars,
		eventType.conflict_calendars ?? [],
		conflictPullWindow(nowInstant, userTz, knobs.maximum_lookahead)
	);
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
		kind: 'reschedule' as const,
		appointment: {
			id: appointment.id,
			start_time: appointment.start_time,
			end_time: appointment.end_time,
			attendee_name: appointment.attendee_name,
			attendee_email: appointment.attendee_email
		},
		eventType: {
			id: eventType.id,
			name: eventType.name,
			slug: eventType.slug,
			duration: eventType.duration,
			description: eventType.description ?? null,
			buffer_before: knobs.buffer_before,
			buffer_after: knobs.buffer_after,
			minimum_notice: knobs.minimum_notice
		},
		slotsByDate,
		workingWindows,
		busyBlocks,
		originalStart: appointment.start_time,
		token: token!
	};
};

export const actions: Actions = {
	default: async ({ params, request, url, locals }) => {
		const session = await locals.auth();
		const initiator: 'attendee' | 'organizer' = session ? 'organizer' : 'attendee';

		const form = await request.formData();
		const slotStr = String(form.get('slot') ?? '');
		const token = String(form.get('token') ?? '');

		if (!slotStr || !token) {
			return fail(400, { error: 'Pick a new time before submitting.' });
		}

		const row = await getDb()
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', params.id)
			.executeTakeFirst();

		if (!row || row.cancel_token !== token) {
			return fail(403, { error: 'Invalid reschedule token.' });
		}

		const cfg = getConfig();
		const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);
		if (!eventType) {
			return fail(404, { error: 'Event type no longer exists.' });
		}

		// Re-validate the slot is currently available (excluding self from blocks).
		const knobs = resolveKnobsFor(cfg, eventType);
		const userTz = cfg.user.timezone;
		const nowInstant = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
		const rangeEnd = nowInstant.add({ hours: 24 * knobs.maximum_lookahead });
		let blocks = await loadAppointmentBlocks(getDb(), eventType.id, nowInstant, rangeEnd, userTz);
		blocks = {
			appointments: blocks.appointments.filter((a) => a.start.toString() !== row.start_time),
			perDayCount: blocks.perDayCount
		};
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
		const end = start.add({ minutes: eventType.duration });

		const result = await rescheduleAppointment(
			{ db: getDb(), cfg, clock: systemClock },
			{
				appointment: row,
				initiator,
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

		redirect(303, `/booked/${row.id}?token=${encodeURIComponent(token)}&rescheduled=1`);
	}
};

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
