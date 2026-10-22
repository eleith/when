import { randomUUID } from 'node:crypto';
import type { RetryPolicy } from 'openworkflow';
import {
	generateVideoChat,
	type GenerateVideoChatInput,
	type GenerateVideoChatResult
} from '@when/jobs';
import {
	findAppointment,
	recordCalendarEventReference,
	type CalendarEventReference
} from '@when/db';
import { getWorkerContext, type WorkerContext } from '../services/context.js';
import { reconcileAppointment as syncCalendarForAppointment } from '../calendar/sync.js';
import {
	tryBookVideoChatEvent,
	publishVideoChat,
	readPendingVideoChat,
	tryRequestMissingVideoChat,
	videoChatResource,
	wantsGeneratedVideoChat,
	type VideoChatAttempt,
	type VideoChatBooking
} from '../services/video-chat.js';
import {
	cleanupAppointmentVideoChat,
	removeUnusedBookingEvent,
	removeUnusedVideoChat
} from '../services/video-chat-cleanup.js';
import { systemClock, type Clock } from '../email/clock.js';
import { implementObservedWorkflow } from '../services/metrics.js';
import {
	notifyAppointment,
	type NotifyAppointmentInput,
	type NotifyAppointmentResult
} from './notify-appointment.js';

const INITIAL_VIDEO_ATTEMPT_TIMEOUT_MS = 5_000;
const PENDING_VIDEO_RETRY: Partial<RetryPolicy> = {
	maximumAttempts: 10,
	initialInterval: '30s',
	backoffCoefficient: 2,
	maximumInterval: '10m'
};
const AFTER_FIRST_ATTEMPT_RETRY: Partial<RetryPolicy> = { maximumAttempts: 9 };

interface GenerationStep {
	run<T>(
		config: { name: string; retryPolicy?: Partial<RetryPolicy> },
		fn: () => Promise<T> | T
	): Promise<T>;
	runWorkflow(
		spec: typeof notifyAppointment,
		input: NotifyAppointmentInput,
		options: { name: string }
	): Promise<NotifyAppointmentResult>;
}

interface PreparedGeneration {
	requestId: string;
	shouldAttach: boolean;
}

export async function runGenerateVideoChat(
	input: GenerateVideoChatInput,
	step: GenerationStep,
	clock: Pick<Clock, 'now'> = systemClock
): Promise<GenerateVideoChatResult> {
	const generation = await prepareGeneration(input, step);
	if (input.notificationKind === 'pending' || input.notificationKind === 'confirmed') {
		const booking = {
			appointmentId: input.appointmentId,
			notificationKind: input.notificationKind
		};
		const result = await generateForBooking(booking, generation, step, clock);
		return result;
	}
	const result = await generateForUpdate(input, generation, step, clock);
	return result;
}

async function prepareGeneration(
	input: GenerateVideoChatInput,
	step: GenerationStep
): Promise<PreparedGeneration> {
	const ctx = getWorkerContext();
	const shouldAttach = await step.run({ name: 'prepare-video-chat' }, async () => {
		const row = await findAppointment(ctx.db, input.appointmentId);
		if (input.notificationKind === 'pending' && row?.status !== 'pending') return false;
		if (input.notificationKind === 'confirmed' && row?.status !== 'confirmed') return false;
		return input.notificationKind !== null && !!row && wantsGeneratedVideoChat(ctx.config, row);
	});
	const requestId = await step.run({ name: 'conference-request-id' }, () => randomUUID());
	return { requestId, shouldAttach };
}

async function generateForBooking(
	input: GenerateVideoChatInput & { notificationKind: 'pending' | 'confirmed' },
	generation: PreparedGeneration,
	step: GenerationStep,
	clock: Pick<Clock, 'now'>
): Promise<GenerateVideoChatResult> {
	const ctx = getWorkerContext();
	let attempt: VideoChatAttempt | null = null;
	if (generation.shouldAttach) {
		const initial = await step.run(
			{ name: 'initial-video-request', retryPolicy: { maximumAttempts: 1 } },
			() => {
				const signal = AbortSignal.timeout(INITIAL_VIDEO_ATTEMPT_TIMEOUT_MS);
				return tryRequestMissingVideoChat(ctx, input.appointmentId, generation.requestId, signal);
			}
		);
		attempt = initial.ok ? initial.attempt : null;
		if (attempt?.status === 'ready') {
			const candidate = attempt;
			await step.run({ name: 'publish-initial-video' }, () =>
				publishForCurrentNotice(ctx, input, candidate, clock)
			);
		}
	}

	await step.run({ name: 'sync-original-notification' }, () =>
		syncNotificationCalendar(ctx, input.appointmentId)
	);
	const receipt = await step.runWorkflow(
		notifyAppointment,
		{ appointmentId: input.appointmentId, kind: input.notificationKind },
		{ name: 'original-notification' }
	);
	// Use saved results here: a fresh state branch could bypass cleanup of accepted continuation resources on replay.
	const needsContinuation = generation.shouldAttach && receipt !== null && !receipt.videoChatUrl;
	if (attempt && (!needsContinuation || attempt.status === 'ready')) {
		const candidate = attempt;
		await step.run({ name: 'cleanup-initial-video' }, () =>
			cleanupGeneratedVideoChat(ctx, candidate, candidate, null)
		);
	}
	if (!needsContinuation) {
		const url = await selectedVideoChatUrl(ctx, input.appointmentId);
		return { url };
	}

	// An accepted pending request is read-only from here; a rejected ready candidate has been cleaned up.
	const pending = attempt?.status === 'pending' ? attempt : null;
	const url = await completeAttachment(input, step, generation.requestId, pending, clock);
	return { url };
}

async function generateForUpdate(
	input: GenerateVideoChatInput,
	generation: PreparedGeneration,
	step: GenerationStep,
	clock: Pick<Clock, 'now'>
): Promise<GenerateVideoChatResult> {
	const ctx = getWorkerContext();
	if (!generation.shouldAttach) {
		await step.run({ name: 'reconcile-video-removal' }, () =>
			reconcileVideoChatRemoval(ctx, input.appointmentId)
		);
		const url = await selectedVideoChatUrl(ctx, input.appointmentId);
		return { url };
	}
	const url = await completeAttachment(input, step, generation.requestId, null, clock);
	return { url };
}

async function completeAttachment(
	input: GenerateVideoChatInput,
	step: GenerationStep,
	requestId: string,
	pending: VideoChatAttempt | null,
	clock: Pick<Clock, 'now'>
): Promise<string | null> {
	const ctx = getWorkerContext();
	const isBooking = input.notificationKind === 'pending' || input.notificationKind === 'confirmed';
	const retryPolicy = isBooking ? AFTER_FIRST_ATTEMPT_RETRY : undefined;
	await step.run({ name: 'reconcile-video-removal' }, () =>
		reconcileVideoChatRemoval(ctx, input.appointmentId)
	);

	let booking: VideoChatBooking | null = null;
	let requested = pending;
	if (!requested) {
		booking = await step.run({ name: 'book-google-event', retryPolicy }, () =>
			bookForCurrentNotice(ctx, input)
		);
		if (booking) {
			const reference = booking.reference;
			await step.run({ name: 'record-booking-reference' }, () =>
				recordCalendarEventReference(ctx.db, input.appointmentId, reference)
			);
		}
		requested = await step.run({ name: 'request-video-chat', retryPolicy }, () =>
			requestForCurrentNotice(ctx, input, requestId)
		);
	}
	let ready = requested;
	if (requested?.status === 'pending') {
		const accepted = requested;
		ready = await step.run(
			{ name: 'read-pending-video-chat', retryPolicy: PENDING_VIDEO_RETRY },
			() => readPendingVideoChat(ctx, accepted)
		);
	}
	const candidate = ready;
	const published = await step.run({ name: 'publish-video-chat' }, () =>
		publishForCurrentNotice(ctx, input, candidate, clock)
	);

	let deletedBookingReference: CalendarEventReference | null = null;
	if (booking?.created) {
		const reference = booking.reference;
		const deleted = await step.run({ name: 'cleanup-unused-booking' }, () =>
			removeUnusedBookingEvent(ctx, reference)
		);
		if (deleted) deletedBookingReference = reference;
	}
	if (requested) {
		const attempt = requested;
		await step.run({ name: 'cleanup-unused-video-chat' }, () =>
			cleanupGeneratedVideoChat(ctx, attempt, candidate, deletedBookingReference)
		);
	}
	if (published !== null && candidate?.url && input.notificationKind !== null) {
		await notifyVideoChatAdded(ctx, input.appointmentId, candidate.url, step);
	}
	const url = await selectedVideoChatUrl(ctx, input.appointmentId);
	return url;
}

async function bookForCurrentNotice(
	ctx: WorkerContext,
	input: GenerateVideoChatInput
): Promise<VideoChatBooking | null> {
	const obsolete = await originalNoticeIsObsolete(ctx, input);
	if (obsolete) return null;
	const result = await tryBookVideoChatEvent(ctx, input.appointmentId);
	if (!result.ok) throw new Error(result.reason);
	return result.booking;
}

async function requestForCurrentNotice(
	ctx: WorkerContext,
	input: GenerateVideoChatInput,
	requestId: string
): Promise<VideoChatAttempt | null> {
	const obsolete = await originalNoticeIsObsolete(ctx, input);
	if (obsolete) return null;
	const result = await tryRequestMissingVideoChat(ctx, input.appointmentId, requestId);
	if (!result.ok) throw new Error(result.reason);
	return result.attempt;
}

async function publishForCurrentNotice(
	ctx: WorkerContext,
	input: GenerateVideoChatInput,
	candidate: VideoChatAttempt | null,
	clock: Pick<Clock, 'now'>
): Promise<number | null> {
	if (!candidate) return null;
	const obsolete = await originalNoticeIsObsolete(ctx, input);
	if (obsolete) return null;
	const sequence = await publishVideoChat(ctx, candidate, clock.now().toISOString());
	return sequence;
}

async function originalNoticeIsObsolete(
	ctx: WorkerContext,
	input: GenerateVideoChatInput
): Promise<boolean> {
	const kind = input.notificationKind;
	if (kind !== 'pending' && kind !== 'confirmed') return false;
	const current = await findAppointment(ctx.db, input.appointmentId);
	return current?.status !== kind;
}

async function notifyVideoChatAdded(
	ctx: WorkerContext,
	appointmentId: string,
	url: string,
	step: GenerationStep
): Promise<void> {
	const current = await findAppointment(ctx.db, appointmentId);
	if (current?.video_chat !== url || current.video_chat_request === 'suppress') return;
	if (current.status !== 'pending' && current.status !== 'confirmed') return;
	await step.run({ name: 'sync-video-notification' }, () =>
		syncNotificationCalendar(ctx, appointmentId)
	);
	await step.runWorkflow(
		notifyAppointment,
		{ appointmentId, kind: 'video-chat-added', videoChatUrl: url },
		{ name: 'video-chat-added-notification' }
	);
}

async function syncNotificationCalendar(ctx: WorkerContext, appointmentId: string): Promise<void> {
	const row = await findAppointment(ctx.db, appointmentId);
	if (!row || row.status === 'purged') return;
	if (row.video_chat_request === 'suppress' && videoChatResource(ctx.config, row)) return;
	await syncCalendarForAppointment(ctx, row);
}

async function reconcileVideoChatRemoval(ctx: WorkerContext, appointmentId: string): Promise<void> {
	const before = await findAppointment(ctx.db, appointmentId);
	const cleaned = await cleanupAppointmentVideoChat(ctx, appointmentId);
	if (!cleaned) throw new Error('Video conference removal could not be confirmed');
	const current = await findAppointment(ctx.db, appointmentId);
	if (!before || !current || current.status === 'purged') return;
	if (
		current.calendar_revision !== before.calendar_revision ||
		current.external_calendar_id !== before.external_calendar_id ||
		current.external_event_id !== before.external_event_id
	)
		return;
	if (
		current.video_chat_request === 'suppress' ||
		(current.status !== 'pending' && current.status !== 'confirmed')
	) {
		await syncCalendarForAppointment(ctx, current);
	}
}

async function cleanupGeneratedVideoChat(
	ctx: WorkerContext,
	requested: VideoChatAttempt,
	candidate: VideoChatAttempt | null,
	deletedBookingReference: CalendarEventReference | null
): Promise<void> {
	const reference = requested.target.resource.calendarEvent;
	if (
		deletedBookingReference &&
		reference &&
		reference.calendarId === deletedBookingReference.calendarId &&
		reference.eventId === deletedBookingReference.eventId
	)
		return;
	const current = await findAppointment(ctx.db, requested.target.appointmentId);
	if (
		candidate?.url &&
		current?.video_chat === candidate.url &&
		(current.status === 'pending' || current.status === 'confirmed')
	)
		return;
	const resource = { ...requested.target.resource, url: candidate?.url ?? requested.url };
	const cleaned = await removeUnusedVideoChat(ctx, resource);
	if (!cleaned) throw new Error('Unused video conference removal could not be confirmed');
}

async function selectedVideoChatUrl(
	ctx: WorkerContext,
	appointmentId: string
): Promise<string | null> {
	const current = await findAppointment(ctx.db, appointmentId);
	if (current?.status !== 'pending' && current?.status !== 'confirmed') return null;
	return current.video_chat;
}

export function registerGenerateVideoChatWorkflow(): void {
	implementObservedWorkflow(generateVideoChat, ({ input, step }) =>
		runGenerateVideoChat(input, step)
	);
}
