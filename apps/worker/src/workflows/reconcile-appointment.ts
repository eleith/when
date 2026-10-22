import { generateVideoChat, getOpenWorkflow, reconcileAppointment } from '@when/jobs';
import type { ReconcileAppointmentInput, ReconcileAppointmentResult } from '@when/jobs';
import { prepareAppointmentEmails } from '../email/dispatch.js';
import { systemClock, type Clock } from '../email/clock.js';
import { getWorkerContext } from '../services/context.js';
import { appendEmailJobLog } from '../services/job-log.js';
import { videoChatResource, wantsGeneratedVideoChat } from '../services/video-chat.js';
import { removeUnusedVideoChat } from '../services/video-chat-cleanup.js';
import { reconcileAppointment as syncCalendarForAppointment } from '../calendar/sync.js';
import { implementObservedWorkflow } from '../services/metrics.js';
import {
	deliverAppointmentEmail,
	type DeliverAppointmentEmailInput,
	type DeliverAppointmentEmailResult
} from './deliver-appointment-email.js';

interface ReconcileStep {
	run<T>(config: { name: string }, fn: () => Promise<T> | T): Promise<T>;
	runWorkflow(
		spec: typeof deliverAppointmentEmail,
		input: DeliverAppointmentEmailInput,
		options: { name: string }
	): Promise<DeliverAppointmentEmailResult>;
}

export async function runReconcileAppointment(
	input: ReconcileAppointmentInput,
	step: ReconcileStep,
	clock: Pick<Clock, 'now'> = systemClock
): Promise<ReconcileAppointmentResult> {
	const ctx = getWorkerContext();
	const liveAppointment = () =>
		ctx.db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', input.appointmentId)
			.where('status', '!=', 'purged')
			.executeTakeFirst();

	const preparation = await step.run({ name: 'prepare-reconciliation' }, async () => {
		const row = await liveAppointment();
		if (!row) return null;
		return true;
	});
	if (!preparation) return 'reconciled';

	if (input.cleanupVideoChatUrl) {
		await step.run({ name: 'cleanup-video-chat' }, async () => {
			const row = await liveAppointment();
			const resource = row ? videoChatResource(ctx.config, row) : null;
			if (resource) {
				const cleaned = await removeUnusedVideoChat(ctx, {
					...resource,
					url: input.cleanupVideoChatUrl!
				});
				if (!cleaned) {
					ctx.logger.warn(
						{ appointmentId: input.appointmentId },
						'old video cleanup unconfirmed; current choice will retry independently'
					);
				}
			}
		});
	}

	await step.run({ name: 'sync-calendar' }, async () => {
		const row = await liveAppointment();
		if (!row) return;
		// Suppression cleanup and content acknowledgment belong to the same background pass.
		if (row.video_chat_request === 'suppress' && videoChatResource(ctx.config, row)) return;
		await syncCalendarForAppointment(ctx, row);
	});

	const kind = input.emailKind;
	const deliveries = await step.run({ name: 'prepare-emails' }, async () => {
		const row = await liveAppointment();
		if (!row || !kind) return [];
		if (
			kind === 'video-chat-added' &&
			(!row.video_chat || (row.status !== 'pending' && row.status !== 'confirmed'))
		)
			return [];
		return prepareAppointmentEmails({ kind, appointment: row }, ctx.config);
	});
	// Save the booking envelopes before independent video work can add a link.
	await step.run({ name: 'request-video-chat' }, async () => {
		const row = await liveAppointment();
		if (!row || !videoChatResource(ctx.config, row)) return;
		const terminal = row.status !== 'pending' && row.status !== 'confirmed';
		if (
			!wantsGeneratedVideoChat(ctx.config, row) &&
			row.video_chat_request !== 'suppress' &&
			!terminal
		)
			return;
		await getOpenWorkflow().runWorkflow(
			generateVideoChat,
			{ appointmentId: row.id },
			{
				idempotencyKey: `generate-video-chat:${row.id}:${row.calendar_revision}`
			}
		);
	});
	if (!kind) return 'reconciled';
	const outcomes = await Promise.all(
		deliveries.map(({ role, envelope }) =>
			step.runWorkflow(
				deliverAppointmentEmail,
				{ appointmentId: input.appointmentId, kind, role, envelope },
				{ name: `email:${role}` }
			)
		)
	);
	if (deliveries.length > 0 && outcomes.every((outcome) => outcome === 'sent')) {
		await step.run({ name: 'log:result' }, () =>
			appendEmailJobLog(ctx.db, input.appointmentId, 'done', clock.now().toISOString())
		);
	}
	return 'reconciled';
}

export function registerReconcileAppointmentWorkflow(): void {
	implementObservedWorkflow(reconcileAppointment, ({ input, step }) =>
		runReconcileAppointment(input, step)
	);
}
