import { error, fail, redirect } from '@sveltejs/kit';
import { shouldAttachVideoChat } from '@when/video-chat';
import { isEditAllowed, isViewAllowed } from '#lib/server/appointment/access.js';
import {
	isActiveStatus,
	resolveAppointmentActions,
	type AppointmentRole
} from '#lib/server/appointment/actions.js';
import { buildAddToCalendarLinks } from '#lib/server/calendar-links/index.js';
import { systemClock } from '#lib/server/clock.js';
import { getConfig, getDb } from '#lib/server/state.js';
import {
	findAppointment,
	findChainTip,
	originId,
	isChainTerminal,
	parseActionLog,
	type Appointment
} from '@when/db';
import { toPublicAppointment } from '#lib/server/appointment/sanitize.js';
import { readMeetingSnapshot } from '#lib/server/appointment/snapshot.js';
import { resolveBookingDurations } from '#lib/server/appointment/duration.js';
import type { Actions, PageServerLoad } from './$types';
import { cancelAppointment } from '#lib/server/appointment/cancel.js';
import { validateReason } from '#lib/server/appointment/form.server.js';
import { appointmentContext } from '#lib/server/appointment/context.js';

type ClockStatus = 'upcoming' | 'in_progress' | 'concluded';

function computeClockStatus(
	row: Pick<Appointment, 'status' | 'start_time' | 'end_time'>,
	now: Date
): ClockStatus | null {
	if (row.status !== 'pending' && row.status !== 'confirmed') return null;
	const nowMs = now.getTime();
	if (nowMs < Date.parse(row.start_time)) return 'upcoming';
	if (nowMs < Date.parse(row.end_time)) return 'in_progress';
	return 'concluded';
}

export const load: PageServerLoad = async ({ params, url, locals, cookies }) => {
	const session = await locals.auth();
	const role: AppointmentRole = session ? 'host' : 'guest';
	const isHost = role === 'host';
	const token = url.searchParams.get('token');

	const flash = cookies.get('submitted');
	if (flash) {
		cookies.delete('submitted', { path: '/' });
	}

	const found = await findAppointment(getDb(), params.id);

	if (!found) error(404, 'Appointment not found.');

	const now = systemClock.now();
	const row = found;

	if (!isHost && !(await isViewAllowed(getDb(), row, token, now))) error(404);

	const cfg = getConfig();
	const eventType = cfg.meetings[row.event_type_id];

	if (!eventType && !isHost) error(404);
	const meeting = eventType
		? { title: eventType.title, description: eventType.description }
		: readMeetingSnapshot(row.meeting_snapshot);
	if (!meeting) error(404, 'Saved meeting details are unavailable.');

	let actions = resolveAppointmentActions({ row, role, now, eventType });
	if (!eventType) {
		actions = {
			cancel: { allowed: false, reason: 'terminal_status' },
			reschedule: { allowed: false, reason: 'terminal_status' },
			accept: { allowed: false, reason: 'terminal_status' },
			decline: { allowed: false, reason: 'terminal_status' },
			generateVideoChat: { allowed: false, reason: 'terminal_status' }
		};
	}

	const clockStatus = computeClockStatus(row, now);

	const tokenEnc = token ? encodeURIComponent(token) : '';
	const bookedUrl = `${url.origin}/appointment/${row.id}${tokenEnc ? `?token=${tokenEnc}` : ''}`;
	const icsUrl = `${url.origin}/appointment/${row.id}/ics${tokenEnc ? `?token=${tokenEnc}` : ''}`;

	const eventName = meeting.title;
	const calendarLinks =
		eventType && row.status === 'confirmed' && clockStatus !== 'concluded'
			? buildAddToCalendarLinks(
					{
						start: row.start_time,
						end: row.end_time,
						title: `${eventName} with ${cfg.user.name}`,
						description: `View or change this appointment: ${bookedUrl}`,
						location: row.location ?? undefined
					},
					icsUrl
				)
			: null;

	const actionLog = parseActionLog(row.action_log);
	const rescheduleToSelf = actionLog.findLast(
		(e) => e.action === 'reschedule' && e.payload?.metadata?.next_id === row.id
	);
	const predecessorId = rescheduleToSelf?.payload?.metadata?.previous_id as string | undefined;
	const predecessor = predecessorId ? await findAppointment(getDb(), predecessorId) : null;
	const tip = row.status === 'rescheduled' ? await findChainTip(getDb(), originId(row)) : null;
	const latest = tip && tip.id !== row.id ? tip : null;

	let deleteCheck = null;
	if (isHost) {
		if (!eventType) {
			deleteCheck = { terminal: true };
		} else {
			deleteCheck = await isChainTerminal(getDb(), row.id, now);
		}
	}

	const appointment = toPublicAppointment(row, role);
	const automaticVideoChat = eventType
		? shouldAttachVideoChat(eventType, cfg, appointment.answers)
		: false;
	const videoChatRequested =
		isHost &&
		Boolean(eventType) &&
		isActiveStatus(row.status) &&
		!row.video_chat &&
		row.video_chat_request !== 'suppress' &&
		(row.video_chat_request === 'generate' || automaticVideoChat);

	const bookingDurations = eventType ? resolveBookingDurations(eventType, role, row) : null;

	return {
		appointment,
		videoChatRequested,
		meeting,
		meetingUnavailable: !eventType,
		bookingDurations,
		canEditDuration: isHost && Boolean(eventType) && isEditAllowed(row, now),
		calendarLinks,
		actions,
		flash: flash ?? null,
		clockStatus,
		// The host is trusted with the guest's cancel_token so reschedule/cancel
		// links work without a token in the URL; guests only ever see their own.
		token: isHost ? (token ?? row.cancel_token) : (token ?? ''),
		role,
		hostTz: cfg.user.timezone,
		guestTz: row.guest_timezone ?? cfg.user.timezone,
		rescheduledFrom: predecessor
			? { id: predecessor.id, start_time: predecessor.start_time }
			: null,
		latestAppointment: latest ? { id: latest.id } : null,
		deleteCheck
	};
};

export const actions: Actions = {
	cancel: async ({ params, request }) => {
		const row = await findAppointment(getDb(), params.id);

		if (!row) return fail(404, { error: 'Appointment not found.' });

		const form = await request.formData();
		const guestToken = String(form.get('token') ?? '');
		if (row.cancel_token !== guestToken) {
			return fail(403, { error: 'Invalid cancel token.' });
		}

		const reasonResult = validateReason(form, 'cancelling');
		if (!reasonResult.ok) return fail(400, { error: reasonResult.error });

		const result = await cancelAppointment(appointmentContext(), {
			appointment: row,
			initiator: 'guest',
			reason: reasonResult.reason
		});
		if (!result.ok) {
			return fail(409, { error: 'This appointment can no longer be cancelled.' });
		}

		redirect(303, `/appointment/${row.id}?token=${encodeURIComponent(guestToken)}`);
	}
};
