import { reconcileAppointment } from '@when/jobs';
import type { ReconcileAppointmentInput, ReconcileAppointmentResult } from '@when/jobs';
import { parseGuestAnswers } from '@when/config';
import { shouldAttachVideoChat } from '@when/video-chat';
import { prepareAppointmentEmails } from '../email/dispatch.js';
import { systemClock, type Clock } from '../email/clock.js';
import { getWorkerContext } from '../services/context.js';
import { appendEmailJobLog } from '../services/job-log.js';
import {
	createStandaloneVideoChat,
	deleteStandaloneVideoChatByUrl
} from '../services/video-chat.js';
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
		const meeting = ctx.config.meetings[row.event_type_id];
		const initialCreation = input.emailKind === 'confirmed' || input.emailKind === 'pending';
		let resolveVideoChat = false;
		if (initialCreation && meeting?.video_chat && !row.video_chat) {
			const answers = parseGuestAnswers(row.guest_answers);
			resolveVideoChat = shouldAttachVideoChat(meeting, ctx.config, answers);
		}
		return { resolveVideoChat };
	});
	if (!preparation) return 'reconciled';

	if (input.cleanupVideoChatUrl) {
		await step.run({ name: 'cleanup-video-chat' }, async () => {
			const row = await liveAppointment();
			if (row) {
				await deleteStandaloneVideoChatByUrl(
					ctx.config,
					row.event_type_id,
					input.cleanupVideoChatUrl!
				);
			}
		});
	}

	if (preparation.resolveVideoChat) {
		await step.run({ name: 'resolve-video-chat' }, async () => {
			if (await liveAppointment()) {
				await createStandaloneVideoChat(ctx.db, input.appointmentId, ctx.config);
			}
		});
	}

	await step.run({ name: 'sync-calendar' }, async () => {
		const row = await liveAppointment();
		if (row) await syncCalendarForAppointment(ctx, row);
	});

	const kind = input.emailKind;
	if (!kind) return 'reconciled';
	const deliveries = await step.run({ name: 'prepare-emails' }, async () => {
		const row = await liveAppointment();
		return row ? prepareAppointmentEmails({ kind, appointment: row }, ctx.config) : [];
	});
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
