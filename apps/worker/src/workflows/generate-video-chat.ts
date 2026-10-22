import { randomUUID } from 'node:crypto';
import type { RetryPolicy } from 'openworkflow';
import {
	generateVideoChat,
	getOpenWorkflow,
	reconcileAppointment,
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
	bookVideoChatEvent,
	publishVideoChat,
	readPendingVideoChat,
	requestMissingVideoChat,
	wantsGeneratedVideoChat,
	type VideoChatAttempt
} from '../services/video-chat.js';
import {
	cleanupAppointmentVideoChat,
	removeUnusedBookingEvent,
	removeUnusedVideoChat
} from '../services/video-chat-cleanup.js';
import { systemClock, type Clock } from '../email/clock.js';
import { implementObservedWorkflow } from '../services/metrics.js';

const PENDING_VIDEO_RETRY: Partial<RetryPolicy> = {
	maximumAttempts: 10,
	initialInterval: '30s',
	backoffCoefficient: 2,
	maximumInterval: '10m'
};

interface GenerationStep {
	run<T>(
		config: { name: string; retryPolicy?: Partial<RetryPolicy> },
		fn: () => Promise<T> | T
	): Promise<T>;
}

export async function runGenerateVideoChat(
	input: GenerateVideoChatInput,
	step: GenerationStep,
	clock: Pick<Clock, 'now'> = systemClock
): Promise<GenerateVideoChatResult> {
	const ctx = getWorkerContext();
	const shouldAttach = await step.run({ name: 'prepare-video-chat' }, async () => {
		const row = await findAppointment(ctx.db, input.appointmentId);
		return !!row && wantsGeneratedVideoChat(ctx.config, row);
	});
	await step.run({ name: 'reconcile-video-removal' }, () =>
		reconcileVideoChatRemoval(ctx, input.appointmentId)
	);
	if (!shouldAttach) {
		const url = await selectedVideoChatUrl(ctx, input.appointmentId);
		return { url };
	}

	const booking = await step.run({ name: 'book-google-event' }, () =>
		bookVideoChatEvent(ctx, input.appointmentId)
	);
	if (booking) {
		await step.run({ name: 'record-booking-reference' }, () =>
			recordCalendarEventReference(ctx.db, input.appointmentId, booking.reference)
		);
	}
	const requestId = await step.run({ name: 'conference-request-id' }, () => randomUUID());
	const requested = await step.run({ name: 'request-video-chat' }, () =>
		requestMissingVideoChat(ctx, input.appointmentId, requestId)
	);
	let ready = requested;
	if (requested?.status === 'pending') {
		ready = await step.run(
			{ name: 'read-pending-video-chat', retryPolicy: PENDING_VIDEO_RETRY },
			() => readPendingVideoChat(ctx, requested)
		);
	}
	const candidate = ready;
	const publishedIcsSequence = await step.run({ name: 'publish-video-chat' }, async () => {
		if (!candidate) return null;
		const sequence = await publishVideoChat(ctx, candidate, clock.now().toISOString());
		return sequence;
	});
	let deletedBookingReference: CalendarEventReference | null = null;
	if (booking?.created) {
		const deleted = await step.run({ name: 'cleanup-unused-booking' }, () =>
			removeUnusedBookingEvent(ctx, booking.reference)
		);
		if (deleted) deletedBookingReference = booking.reference;
	}
	if (requested) {
		await step.run({ name: 'cleanup-unused-video-chat' }, () =>
			cleanupGeneratedVideoChat(ctx, requested, candidate, deletedBookingReference)
		);
	}
	if (publishedIcsSequence !== null && candidate?.url) {
		const url = candidate.url;
		await step.run({ name: 'notify-video-chat-added' }, () =>
			enqueueVideoChatAdded(ctx, input.appointmentId, url, publishedIcsSequence)
		);
	}
	const url = await selectedVideoChatUrl(ctx, input.appointmentId);
	return { url };
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

async function enqueueVideoChatAdded(
	ctx: WorkerContext,
	appointmentId: string,
	url: string,
	publishedIcsSequence: number
): Promise<void> {
	const current = await findAppointment(ctx.db, appointmentId);
	if (!current || current.video_chat !== url || current.video_chat_request === 'suppress') return;
	if (current.status !== 'pending' && current.status !== 'confirmed') return;
	await getOpenWorkflow().runWorkflow(
		reconcileAppointment,
		{ appointmentId, emailKind: 'video-chat-added' },
		{ idempotencyKey: `${appointmentId}:video-chat-added:${publishedIcsSequence}` }
	);
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
