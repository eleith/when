import { error, fail, redirect } from '@sveltejs/kit';
import { Temporal } from '@js-temporal/polyfill';
import { computeSlots } from '$lib/server/availability';
import { loadAppointmentBlocks } from '$lib/server/availability/db-blocks';
import { resolveKnobsFor } from '$lib/server/availability/knobs';
import { pullConflictBusy } from '$lib/server/calendar/conflicts';
import { pushAppointment } from '$lib/server/calendar/push';
import { systemClock } from '$lib/server/clock';
import type { Location } from '$lib/server/config/schema';
import type { Appointment } from '$lib/server/db';
import { mergeNotificationStatus } from '$lib/server/db/notification-status';
import { logger } from '$lib/server/logger';
import { sendEmail } from '$lib/server/smtp';
import { getConfig, getDb } from '$lib/server/state';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const cfg = getConfig();
	const eventType = cfg.event_types.find((e) => e.slug === params.slug);
	if (!eventType) error(404, `No event type with slug "${params.slug}"`);

	const rescheduleId = url.searchParams.get('reschedule');
	const rescheduleToken = url.searchParams.get('token');
	let reschedule: { id: string; name: string; email: string } | null = null;

	if (rescheduleId && rescheduleToken) {
		const existing = await getDb()
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', rescheduleId)
			.executeTakeFirst();
		if (
			existing &&
			existing.cancel_token === rescheduleToken &&
			existing.event_type_id === eventType.id &&
			(existing.status === 'pending' || existing.status === 'confirmed')
		) {
			reschedule = {
				id: existing.id,
				name: existing.attendee_name,
				email: existing.attendee_email
			};
		}
	}

	const knobs = resolveKnobsFor(cfg, eventType);
	const userTz = cfg.user.timezone;
	const nowInstant = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
	const rangeEnd = nowInstant.add({ hours: 24 * knobs.maximum_lookahead });

	const blocks = await loadAppointmentBlocks(getDb(), eventType.id, nowInstant, rangeEnd, userTz);
	const remoteBusy = await pullConflictBusy(cfg.calendars, eventType.conflict_calendars ?? [], {
		start: nowInstant,
		end: rangeEnd
	});
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
		selectedSlot,
		reschedule,
		token: rescheduleToken ?? null
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
				created_at: '',
				updated_at: ''
			};
			const cancelUrl = `${url.origin}/booked/${id}?token=${encodeURIComponent(cancelToken)}`;
			const pushed = await pushAppointment(cfg, appt, eventType.destination_calendar, {
				cancelUrl
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
		}

		if (status === 'pending' && responseToken) {
			const acceptUrl = `${url.origin}/admin/respond/${id}?action=accept&token=${encodeURIComponent(responseToken)}`;
			const declineUrl = `${url.origin}/admin/respond/${id}?action=decline&token=${encodeURIComponent(responseToken)}`;
			const result = await sendEmail({
				to: cfg.user.email,
				subject: `Booking request: ${eventType.name} from ${name}`,
				text:
					`${name} <${email}> has requested to book ${eventType.name}.\n\n` +
					`When: ${start.toString()}\n` +
					`Duration: ${eventType.duration} min\n` +
					(resolvedLocation ? `Where: ${resolvedLocation}\n\n` : '\n') +
					`Accept: ${acceptUrl}\n` +
					`Decline: ${declineUrl}\n`
			});
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
	},

	reschedule: async ({ request, params, url }) => {
		const cfg = getConfig();
		const eventType = cfg.event_types.find((e) => e.slug === params.slug);
		if (!eventType) error(404);

		const form = await request.formData();
		const slotStr = String(form.get('slot') ?? '');
		const rescheduleId = String(form.get('reschedule_id') ?? '');
		const formToken = String(form.get('token') ?? '');

		if (!slotStr || !rescheduleId || !formToken) {
			return fail(400, { error: 'Missing required fields.' });
		}

		const existing = await getDb()
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', rescheduleId)
			.executeTakeFirst();

		if (
			!existing ||
			existing.cancel_token !== formToken ||
			existing.event_type_id !== eventType.id
		) {
			return fail(403, { error: 'Invalid reschedule token.' });
		}

		if (existing.status !== 'pending' && existing.status !== 'confirmed') {
			return fail(400, { error: 'Booking can no longer be rescheduled.' });
		}

		// Re-validate the slot is currently available (excluding this appointment from blocks).
		const knobs = resolveKnobsFor(cfg, eventType);
		const userTz = cfg.user.timezone;
		const nowInstant = Temporal.Instant.fromEpochMilliseconds(systemClock.nowMs());
		const rangeEnd = nowInstant.add({ hours: 24 * knobs.maximum_lookahead });
		let blocks = await loadAppointmentBlocks(getDb(), eventType.id, nowInstant, rangeEnd, userTz);
		blocks = {
			appointments: blocks.appointments.filter((a) => a.start.toString() !== existing.start_time),
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

		try {
			await getDb()
				.updateTable('appointments')
				.set({
					start_time: start.toString(),
					end_time: end.toString(),
					updated_at: systemClock.now().toISOString()
				})
				.where('id', '=', rescheduleId)
				.execute();
		} catch (err) {
			if (isUniqueViolation(err)) {
				return fail(409, { error: 'That time was just taken. Please pick another.' });
			}
			logger.error(
				{ err, eventTypeId: eventType.id, slot: slotStr, rescheduleId },
				'failed to reschedule booking'
			);
			return fail(500, { error: 'Could not save the reschedule. Please try again.' });
		}

		if (existing.external_event_id && existing.external_calendar_id) {
			const updated: Appointment = {
				...existing,
				start_time: start.toString(),
				end_time: end.toString()
			};
			const cancelUrl = `${url.origin}/booked/${rescheduleId}?token=${encodeURIComponent(existing.cancel_token)}`;
			const pushed = await pushAppointment(cfg, updated, existing.external_calendar_id, {
				cancelUrl
			});
			if (!pushed.ok) {
				const current = await getDb()
					.selectFrom('appointments')
					.select('notification_status')
					.where('id', '=', rescheduleId)
					.executeTakeFirst();
				await getDb()
					.updateTable('appointments')
					.set({
						notification_status: mergeNotificationStatus(current?.notification_status ?? null, {
							calendar_push: 'failed'
						})
					})
					.where('id', '=', rescheduleId)
					.execute();
			}
		}

		redirect(303, `/booked/${rescheduleId}?token=${encodeURIComponent(existing.cancel_token)}`);
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
