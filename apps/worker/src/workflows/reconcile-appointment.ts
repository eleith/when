import {
	generateVideoChat,
	getOpenWorkflow,
	reconcileAppointment,
	type GenerateVideoChatInput,
	type AppointmentEmailKind,
	type ReconcileAppointmentInput,
	type ReconcileAppointmentResult
} from '@when/jobs';
import { videoChatGenerationKey } from '@when/jobs/specs';
import { parseGuestAnswers } from '@when/config';
import { shouldAttachVideoChat } from '@when/video-chat';
import { findAppointment, type Appointment } from '@when/db';
import { getWorkerContext, type WorkerContext } from '../services/context.js';
import { videoChatResource, wantsGeneratedVideoChat } from '../services/video-chat.js';
import { removeUnusedVideoChat } from '../services/video-chat-cleanup.js';
import { reconcileAppointment as syncCalendarForAppointment } from '../calendar/sync.js';
import { implementObservedWorkflow } from '../services/metrics.js';
import {
	notifyAppointment,
	type NotifyAppointmentInput,
	type NotifyAppointmentResult
} from './notify-appointment.js';

interface ReconcileStep {
	run<T>(config: { name: string }, fn: () => Promise<T> | T): Promise<T>;
	runWorkflow(
		spec: typeof notifyAppointment,
		input: NotifyAppointmentInput,
		options: { name: string }
	): Promise<NotifyAppointmentResult>;
}

export async function runReconcileAppointment(
	input: ReconcileAppointmentInput,
	step: ReconcileStep
): Promise<ReconcileAppointmentResult> {
	const ctx = getWorkerContext();
	const routing = await step.run({ name: 'prepare-reconciliation' }, () =>
		prepareReconciliation(ctx, input)
	);
	if (!routing) return 'reconciled';

	const previousUrl = input.cleanupVideoChatUrl;
	if (previousUrl) {
		await step.run({ name: 'cleanup-video-chat' }, () =>
			cleanupPreviousVideoChat(ctx, input.appointmentId, previousUrl)
		);
	}
	await step.run({ name: 'sync-calendar' }, () => syncCurrentCalendar(ctx, input.appointmentId));

	if (routing.videoNotificationKind) {
		await step.run({ name: 'delegate-booking-notification' }, async () => {
			const row = await findAppointment(ctx.db, input.appointmentId);
			if (!row) return;
			await enqueueVideoChat(row.id, routing.calendarRevision, routing.videoNotificationKind);
		});
		return 'reconciled';
	}

	await step.run({ name: 'request-video-chat' }, () =>
		queueVideoChatReconciliation(ctx, input.appointmentId)
	);
	const kind = input.emailKind;
	if (kind) {
		const notification = await step.run({ name: 'prepare-notification' }, () =>
			prepareNotification(ctx, input.appointmentId, kind)
		);
		if (notification) {
			await step.runWorkflow(notifyAppointment, notification, { name: 'notify-appointment' });
		}
	}
	return 'reconciled';
}

async function prepareReconciliation(
	ctx: WorkerContext,
	input: ReconcileAppointmentInput
): Promise<{
	videoNotificationKind: 'pending' | 'confirmed' | null;
	calendarRevision: number;
} | null> {
	const row = await findAppointment(ctx.db, input.appointmentId);
	if (!row || row.status === 'purged') return null;
	const kind = input.emailKind;
	if (kind === 'pending' || kind === 'confirmed') {
		if (row.status !== kind) return null;
	}
	const videoNotificationKind = automaticVideoNotification(ctx, row, kind);
	return { videoNotificationKind, calendarRevision: row.calendar_revision };
}

function automaticVideoNotification(
	ctx: WorkerContext,
	row: Appointment,
	kind: AppointmentEmailKind | undefined
): 'pending' | 'confirmed' | null {
	if (kind !== 'pending' && kind !== 'confirmed') return null;
	if (!wantsGeneratedVideoChat(ctx.config, row)) return null;
	const meeting = ctx.config.meetings[row.event_type_id];
	const answers = parseGuestAnswers(row.guest_answers);
	if (!shouldAttachVideoChat(meeting, ctx.config, answers)) return null;
	return kind;
}

async function cleanupPreviousVideoChat(
	ctx: WorkerContext,
	appointmentId: string,
	url: string
): Promise<void> {
	const row = await findAppointment(ctx.db, appointmentId);
	const resource = row ? videoChatResource(ctx.config, row) : null;
	if (!resource) return;
	const cleaned = await removeUnusedVideoChat(ctx, { ...resource, url });
	if (!cleaned) {
		ctx.logger.warn(
			{ appointmentId },
			'old video cleanup unconfirmed; current choice will retry independently'
		);
	}
}

async function syncCurrentCalendar(ctx: WorkerContext, appointmentId: string): Promise<void> {
	const row = await findAppointment(ctx.db, appointmentId);
	if (!row || row.status === 'purged') return;
	if (row.video_chat_request === 'suppress' && videoChatResource(ctx.config, row)) return;
	await syncCalendarForAppointment(ctx, row);
}

async function queueVideoChatReconciliation(
	ctx: WorkerContext,
	appointmentId: string
): Promise<void> {
	const row = await findAppointment(ctx.db, appointmentId);
	if (!row || row.status === 'purged' || !videoChatResource(ctx.config, row)) return;
	if (wantsGeneratedVideoChat(ctx.config, row)) {
		await enqueueVideoChat(row.id, row.calendar_revision, 'video-chat-added');
		return;
	}
	if (
		row.video_chat_request === 'suppress' ||
		(row.status !== 'pending' && row.status !== 'confirmed')
	) {
		await enqueueVideoChat(row.id, row.calendar_revision, null);
	}
}

async function prepareNotification(
	ctx: WorkerContext,
	appointmentId: string,
	kind: AppointmentEmailKind
): Promise<NotifyAppointmentInput | null> {
	if (kind !== 'video-chat-added') return { appointmentId, kind };
	const row = await findAppointment(ctx.db, appointmentId);
	if (!row?.video_chat || row.video_chat_request === 'suppress') return null;
	return { appointmentId, kind, videoChatUrl: row.video_chat };
}

async function enqueueVideoChat(
	appointmentId: string,
	calendarRevision: number,
	notificationKind: GenerateVideoChatInput['notificationKind']
): Promise<void> {
	await getOpenWorkflow().runWorkflow(
		generateVideoChat,
		{ appointmentId, notificationKind },
		{ idempotencyKey: videoChatGenerationKey(appointmentId, calendarRevision, notificationKind) }
	);
}

export function registerReconcileAppointmentWorkflow(): void {
	implementObservedWorkflow(reconcileAppointment, ({ input, step }) =>
		runReconcileAppointment(input, step)
	);
}
