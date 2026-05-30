import { error, fail, redirect } from '@sveltejs/kit';
import { Temporal } from '@js-temporal/polyfill';
import { computeSlots } from '$lib/server/availability';
import { mergeBlocks } from '$lib/server/availability/blocks';
import { loadAppointmentBlocks } from '$lib/server/availability/db-blocks';
import { resolveKnobsFor } from '$lib/server/availability/knobs';
import { buildBaseWindows, candidateDates } from '$lib/server/availability/windows';
import { conflictPullWindow, pullConflictBusy } from '$lib/server/calendar/conflicts';
import { pushAppointment } from '$lib/server/calendar/push';
import { systemClock } from '$lib/server/clock';
import type { Location } from '$lib/server/config/schema';
import type { Appointment } from '$lib/server/db';
import { mergeNotificationStatus } from '$lib/server/db/notification-status';
import { logger } from '$lib/server/logger';
import { notify } from '$lib/server/notify';
import { getConfig, getDb } from '$lib/server/state';
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

		if (status === 'confirmed') {
			const appt: Appointment = {
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
				notification_status: null,
				ics_sequence: 0,
				created_at: '',
				updated_at: ''
			};
			const cancelTokenEnc = encodeURIComponent(cancelToken);
			const bookedUrl = `${url.origin}/booked/${id}?token=${cancelTokenEnc}`;
			const cancelUrl = `${url.origin}/booked/${id}?token=${cancelTokenEnc}&cancel=1`;
			const rescheduleUrl = `${url.origin}/schedule/${eventType.slug}?reschedule=${id}&token=${cancelTokenEnc}`;
			const pushed = await pushAppointment(cfg, appt, eventType.destination_calendar, {
				cancelUrl: bookedUrl
			});
			if (pushed.ok) {
				await getDb()
					.updateTable('appointments')
					.set({
						external_event_id: pushed.externalEventId,
						external_calendar_id: pushed.externalCalendarId,
						updated_at: systemClock.now().toISOString()
					})
					.where('id', '=', id)
					.execute();
			} else {
				const current = await getDb()
					.selectFrom('appointments')
					.select('notification_status')
					.where('id', '=', id)
					.executeTakeFirst();
				await getDb()
					.updateTable('appointments')
					.set({
						notification_status: mergeNotificationStatus(current?.notification_status ?? null, {
							calendar_push: 'failed'
						})
					})
					.where('id', '=', id)
					.execute();
			}

			const notifyResult = await notify('booking_confirmed', {
				cfg,
				appointment: appt,
				eventType,
				cancelUrl,
				rescheduleUrl,
				bookedUrl
			});
			if (!notifyResult.ok) {
				const current = await getDb()
					.selectFrom('appointments')
					.select('notification_status')
					.where('id', '=', id)
					.executeTakeFirst();
				await getDb()
					.updateTable('appointments')
					.set({
						notification_status: mergeNotificationStatus(current?.notification_status ?? null, {
							email: 'failed'
						})
					})
					.where('id', '=', id)
					.execute();
			}
		}

		if (status === 'pending' && responseToken) {
			const manageUrl = `${url.origin}/signin?callbackUrl=${encodeURIComponent(`/booked/${id}`)}`;
			const cancelTokenEnc = encodeURIComponent(cancelToken);
			const bookedUrl = `${url.origin}/booked/${id}?token=${cancelTokenEnc}`;
			const cancelUrl = `${url.origin}/booked/${id}?token=${cancelTokenEnc}&cancel=1`;
			const rescheduleUrl = `${url.origin}/schedule/${eventType.slug}?reschedule=${id}&token=${cancelTokenEnc}`;
			const appt: Appointment = {
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
				notification_status: null,
				ics_sequence: 0,
				created_at: '',
				updated_at: ''
			};
			const [organizerResult, attendeeResult] = await Promise.all([
				notify('booking_pending_to_organizer', {
					cfg,
					appointment: appt,
					eventType,
					cancelUrl,
					rescheduleUrl,
					bookedUrl,
					manageUrl
				}),
				notify('booking_pending_to_attendee', {
					cfg,
					appointment: appt,
					eventType,
					cancelUrl,
					rescheduleUrl,
					bookedUrl
				})
			]);
			const result = { ok: organizerResult.ok && attendeeResult.ok };
			if (!result.ok) {
				const current = await getDb()
					.selectFrom('appointments')
					.select('notification_status')
					.where('id', '=', id)
					.executeTakeFirst();
				await getDb()
					.updateTable('appointments')
					.set({
						notification_status: mergeNotificationStatus(current?.notification_status ?? null, {
							email: 'failed'
						})
					})
					.where('id', '=', id)
					.execute();
			}
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
