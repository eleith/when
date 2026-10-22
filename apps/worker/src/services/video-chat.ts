import { findCalendar, parseGuestAnswers, type WhenConfiguration } from '@when/config';
import {
	appendActionLogSql,
	findAppointment,
	withWriteTransaction,
	type Appointment,
	type CalendarEventReference
} from '@when/db';
import { getGoogleEvent, patchGoogleEvent, pushAppointment } from '@when/calendar';
import {
	getVideoChatAdapter,
	shouldAttachVideoChat,
	type VideoChatAdapter
} from '@when/video-chat';
import { sql } from 'kysely';
import type { WorkerContext } from './context.js';
import { appointmentLinks } from '../links.js';

export interface VideoChatResource {
	providerName: string;
	calendarEvent: CalendarEventReference | null;
	url: string | null;
}

export interface VideoChatTarget {
	appointmentId: string;
	revision: number;
	resource: VideoChatResource;
}

export interface VideoChatAttempt {
	target: VideoChatTarget;
	status: 'ready' | 'pending';
	url: string | null;
}

export interface VideoChatBooking {
	reference: CalendarEventReference;
	created: boolean;
}

export function wantsGeneratedVideoChat(config: WhenConfiguration, row: Appointment): boolean {
	if (row.status !== 'pending' && row.status !== 'confirmed') return false;
	if (row.video_chat || row.video_chat_request === 'suppress') return false;
	const meeting = config.meetings[row.event_type_id];
	const service = meeting?.video_chat ? config.providers[meeting.video_chat.provider] : undefined;
	if (!meeting || !service || (service.type !== 'google' && service.type !== 'nextcloud'))
		return false;
	if (row.video_chat_request === 'generate') return true;
	const answers = parseGuestAnswers(row.guest_answers);
	return shouldAttachVideoChat(meeting, config, answers);
}

export function videoChatResource(
	config: WhenConfiguration,
	row: Appointment
): VideoChatResource | null {
	let providerName = config.meetings[row.event_type_id]?.video_chat?.provider;
	if (!providerName && row.external_calendar_id && row.external_event_id) {
		const calendar = findCalendar(config, row.external_calendar_id);
		if (calendar?.type === 'google') providerName = calendar.providerName;
	}
	const provider = providerName ? config.providers[providerName] : undefined;
	if (!providerName || !provider) return null;
	return {
		providerName,
		calendarEvent:
			provider.type === 'google' && row.external_calendar_id && row.external_event_id
				? { calendarId: row.external_calendar_id, eventId: row.external_event_id }
				: null,
		url: row.video_chat
	};
}

export function videoChatAdapter(
	ctx: WorkerContext,
	resource: VideoChatResource
): VideoChatAdapter {
	const provider = ctx.config.providers[resource.providerName];
	if (!provider) throw new Error('Video chat provider no longer exists');
	if (provider.type !== 'google') return getVideoChatAdapter(provider);
	const reference = resource.calendarEvent;
	const calendar = reference ? findCalendar(ctx.config, reference.calendarId) : undefined;
	if (!reference || calendar?.type !== 'google') {
		throw new Error('Google Meet requires an already-booked Google event');
	}
	const service = calendar.provider;
	const config = {
		client_id: service.client_id,
		client_secret: service.client_secret,
		refresh_token: service.refresh_token,
		google_calendar_id: calendar.calendar.id
	};
	return getVideoChatAdapter(provider, {
		id: reference.eventId,
		read: () => getGoogleEvent(config, reference.eventId),
		patch: (fields, query) => patchGoogleEvent(config, reference.eventId, fields, query)
	});
}

export async function bookVideoChatEvent(
	ctx: WorkerContext,
	appointmentId: string
): Promise<VideoChatBooking | null> {
	const row = await findAppointment(ctx.db, appointmentId);
	if (!row || !wantsGeneratedVideoChat(ctx.config, row)) return null;
	const resource = videoChatResource(ctx.config, row);
	if (!resource || ctx.config.providers[resource.providerName]?.type !== 'google') return null;
	if (resource.calendarEvent) return { reference: resource.calendarEvent, created: false };
	if (row.status !== 'confirmed') return null;
	const calendarId =
		row.external_calendar_id ?? ctx.config.meetings[row.event_type_id]?.booking_calendar;
	const calendar = calendarId ? findCalendar(ctx.config, calendarId) : undefined;
	if (calendar?.type !== 'google')
		throw new Error('Google Meet requires a Google booking calendar');
	const cancelUrl = appointmentLinks({ baseUrl: ctx.config.url.app, appointment: row }).booked;
	const result = await pushAppointment(ctx.config, row, calendar.name, { cancelUrl });
	if (!result.ok || !result.externalEventId || !result.externalCalendarId) {
		throw new Error('Could not book the Google event for video attachment');
	}
	return {
		reference: { calendarId: result.externalCalendarId, eventId: result.externalEventId },
		created: !row.external_event_id
	};
}

async function currentTarget(
	ctx: WorkerContext,
	target: VideoChatTarget
): Promise<Appointment | null> {
	const row = await findAppointment(ctx.db, target.appointmentId);
	if (
		!row ||
		row.calendar_revision !== target.revision ||
		!wantsGeneratedVideoChat(ctx.config, row)
	)
		return null;
	const resource = videoChatResource(ctx.config, row);
	if (!sameVideoChatResource(resource, target.resource)) return null;
	return row;
}

function sameVideoChatResource(left: VideoChatResource | null, right: VideoChatResource): boolean {
	if (!left || left.providerName !== right.providerName) return false;
	return (
		left.calendarEvent?.calendarId === right.calendarEvent?.calendarId &&
		left.calendarEvent?.eventId === right.calendarEvent?.eventId
	);
}

export async function requestMissingVideoChat(
	ctx: WorkerContext,
	appointmentId: string,
	requestId: string
): Promise<VideoChatAttempt | null> {
	const row = await findAppointment(ctx.db, appointmentId);
	if (!row || !wantsGeneratedVideoChat(ctx.config, row)) return null;
	const resource = videoChatResource(ctx.config, row);
	if (!resource) return null;
	if (ctx.config.providers[resource.providerName]?.type === 'google' && !resource.calendarEvent)
		return null;
	const target = { appointmentId, revision: row.calendar_revision, resource };
	const adapter = videoChatAdapter(ctx, resource);
	const observed = await adapter.read(null);
	if (!observed.ok) throw new Error(observed.reason);
	if (observed.status === 'ready') return { target, status: 'ready', url: observed.url };
	if (observed.status === 'pending') return { target, status: 'pending', url: null };
	if (observed.status !== 'absent') throw new Error(`Video chat observation is ${observed.status}`);
	const current = await currentTarget(ctx, target);
	if (!current) return null;
	const result = await adapter.request({ name: `Meeting: ${current.guest_name}`, requestId });
	if (!result.ok) throw new Error(result.reason);
	if (result.status === 'ready') return { target, status: 'ready', url: result.url };
	if (result.status === 'pending') return { target, status: 'pending', url: null };
	throw new Error(`Video chat request is ${result.status}`);
}

export async function readPendingVideoChat(
	ctx: WorkerContext,
	attempt: VideoChatAttempt
): Promise<VideoChatAttempt | null> {
	const row = await currentTarget(ctx, attempt.target);
	if (!row) return null;
	const result = await videoChatAdapter(ctx, attempt.target.resource).read(null);
	if (!result.ok) throw new Error(result.reason);
	if (result.status !== 'ready') throw new Error(`Video chat is ${result.status}`);
	return { target: attempt.target, status: 'ready', url: result.url };
}

export async function publishVideoChat(
	ctx: WorkerContext,
	attempt: VideoChatAttempt,
	now: string
): Promise<number | null> {
	const url = attempt.url;
	if (attempt.status !== 'ready' || !url) return null;
	const published = await withWriteTransaction(ctx.db, async (connection) => {
		const row = await findAppointment(connection, attempt.target.appointmentId);
		if (!row || (row.status !== 'pending' && row.status !== 'confirmed')) return null;
		if (!sameVideoChatResource(videoChatResource(ctx.config, row), attempt.target.resource))
			return null;
		// A committed URI can outlive its step checkpoint; do not repeat its edit.
		if (row.video_chat === url && row.video_chat_request !== 'suppress') return row.ics_sequence;
		if (
			row.calendar_revision !== attempt.target.revision ||
			!wantsGeneratedVideoChat(ctx.config, row)
		)
			return null;
		const updated = await connection
			.updateTable('appointments')
			.set({
				video_chat: url,
				calendar_revision: sql`calendar_revision + 1`,
				ics_sequence: sql`ics_sequence + 1`,
				action_log: appendActionLogSql({
					action: 'edit',
					actor: row.video_chat_request === 'generate' ? 'host' : 'system',
					at: now,
					payload: { metadata: { changes: ['video_chat_added'] } }
				}),
				updated_at: sql`CURRENT_TIMESTAMP`
			})
			.where('id', '=', row.id)
			.returning('ics_sequence')
			.executeTakeFirstOrThrow();
		return updated.ics_sequence;
	});
	return published;
}
