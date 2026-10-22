import { deleteAppointmentFromCalendar } from '@when/calendar';
import { findCalendar } from '@when/config';
import {
	findAppointment,
	listActiveAppointmentsForCalendarEvent,
	type CalendarEventReference
} from '@when/db';
import { nextcloudRoomToken } from '@when/video-chat';
import type { WorkerContext } from './context.js';
import { videoChatAdapter, wantsGeneratedVideoChat, type VideoChatResource } from './video-chat.js';

/** Remove only remote resources; selected URLs remain evidence until the row is deleted. */
export async function removeUnusedVideoChat(
	ctx: WorkerContext,
	resource: VideoChatResource
): Promise<boolean> {
	const service = ctx.config.providers[resource.providerName];
	if (service?.type === 'nextcloud') {
		if (resource.url === null) return true;
		const token = nextcloudRoomToken(service, resource.url);
		if (token) {
			const active = await ctx.db
				.selectFrom('appointments')
				.select('video_chat')
				.where('status', 'in', ['pending', 'confirmed'])
				.where('video_chat', 'is not', null)
				.execute();
			if (active.some((row) => nextcloudRoomToken(service, row.video_chat!) === token)) {
				return true;
			}
		}
		try {
			const adapter = videoChatAdapter(ctx, resource);
			const removed = await adapter.removeLink(resource.url);
			if (!removed.ok) {
				ctx.logger.warn({ provider: resource.providerName }, 'video chat room cleanup failed');
			}
		} catch {
			ctx.logger.warn({ provider: resource.providerName }, 'video chat room cleanup failed');
		}
		// Standalone deletion remains best effort, as before.
		return true;
	}

	const reference = resource.calendarEvent;
	const calendar = reference ? findCalendar(ctx.config, reference.calendarId) : undefined;
	if (service?.type !== 'google' || !reference || calendar?.type !== 'google') {
		ctx.logger.warn(
			{ provider: resource.providerName },
			'video chat cleanup has no proven binding'
		);
		return false;
	}

	const adapter = videoChatAdapter(ctx, resource);
	const observed = await adapter.read(resource.url);
	if (!observed.ok || observed.status === 'ambiguous') {
		ctx.logger.warn({ provider: resource.providerName }, 'video chat cleanup read unconfirmed');
		return false;
	}
	if (observed.status === 'absent') return true;
	// Reload references after the provider read, which can outlive a host edit.
	const active = await listActiveAppointmentsForCalendarEvent(ctx.db, reference);
	if (
		active.some(
			(row) =>
				(observed.status === 'ready' && row.video_chat === observed.url) ||
				wantsGeneratedVideoChat(ctx.config, row)
		)
	) {
		return true;
	}
	const removed = await adapter.removeLink(resource.url);
	if (removed.ok) return true;
	ctx.logger.warn({ provider: resource.providerName }, 'video chat cleanup removal unconfirmed');
	return false;
}

export async function cleanupAppointmentVideoChat(
	ctx: WorkerContext,
	appointmentId: string
): Promise<boolean> {
	const row = await findAppointment(ctx.db, appointmentId);
	if (!row) return true;
	const removesBooking =
		row.status === 'cancelled' ||
		row.status === 'declined' ||
		row.status === 'expired' ||
		row.status === 'purged';
	if (removesBooking) {
		// The caller's strict booking deletion subsumes Google conference cleanup.
		const cleaned = await cleanupStandaloneVideoChat(ctx, appointmentId);
		return cleaned;
	}
	const active = row.status === 'pending' || row.status === 'confirmed';
	if (active && row.video_chat === null && row.video_chat_request !== 'suppress') return true;
	const reference =
		row.external_calendar_id && row.external_event_id
			? { calendarId: row.external_calendar_id, eventId: row.external_event_id }
			: null;
	const calendar = reference ? findCalendar(ctx.config, reference.calendarId) : undefined;
	if (calendar?.type === 'google') {
		const removed = await removeUnusedVideoChat(ctx, {
			providerName: calendar.providerName,
			calendarEvent: reference,
			url: row.video_chat
		});
		if (!removed) return false;
	}

	const cleaned = await cleanupStandaloneVideoChat(ctx, appointmentId);
	return cleaned;
}

/** Booking deletion subsumes Google cleanup, but not independent Talk rooms. */
export async function cleanupStandaloneVideoChat(
	ctx: WorkerContext,
	appointmentId: string
): Promise<boolean> {
	const row = await findAppointment(ctx.db, appointmentId);
	if (!row || row.status === 'pending' || row.status === 'confirmed' || row.video_chat === null) {
		return true;
	}
	const providerName = ctx.config.meetings[row.event_type_id]?.video_chat?.provider;
	if (!providerName || ctx.config.providers[providerName]?.type !== 'nextcloud') return true;
	const removed = await removeUnusedVideoChat(ctx, {
		providerName,
		calendarEvent: null,
		url: row.video_chat
	});
	return removed;
}

/** For newly-created rejected bookings: true confirms deletion; false means active references protect it. */
export async function removeUnusedBookingEvent(
	ctx: WorkerContext,
	reference: CalendarEventReference
): Promise<boolean> {
	const active = await listActiveAppointmentsForCalendarEvent(ctx.db, reference);
	if (active.length > 0) return false;
	const removed = await deleteAppointmentFromCalendar(
		ctx.config,
		reference.calendarId,
		reference.eventId
	);
	if (!removed.ok) throw new Error(removed.reason);
	return true;
}
