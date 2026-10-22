import { defineWorkflowSpec } from 'openworkflow';
import { findAppointment } from '@when/db';
import type { AppointmentEmailKind, WorkflowSpec } from '@when/jobs';
import { prepareAppointmentEmails } from '../email/dispatch.js';
import { systemClock, type Clock } from '../email/clock.js';
import { getWorkerContext } from '../services/context.js';
import { appendEmailJobLog } from '../services/job-log.js';
import { implementObservedWorkflow } from '../services/metrics.js';
import {
	deliverAppointmentEmail,
	type DeliverAppointmentEmailInput,
	type DeliverAppointmentEmailResult
} from './deliver-appointment-email.js';

export type NotifyAppointmentInput =
	| { appointmentId: string; kind: Exclude<AppointmentEmailKind, 'video-chat-added'> }
	| { appointmentId: string; kind: 'video-chat-added'; videoChatUrl: string };

export type NotifyAppointmentResult = { videoChatUrl: string | null } | null;

export const notifyAppointment: WorkflowSpec<NotifyAppointmentInput, NotifyAppointmentResult> =
	defineWorkflowSpec({ name: 'notify-appointment' });

interface NativeStep {
	run<T>(config: { name: string }, fn: () => Promise<T> | T): Promise<T>;
	runWorkflow(
		spec: typeof deliverAppointmentEmail,
		input: DeliverAppointmentEmailInput,
		options: { name: string }
	): Promise<DeliverAppointmentEmailResult>;
}

export async function runNotifyAppointment(
	input: NotifyAppointmentInput,
	step: NativeStep,
	clock: Pick<Clock, 'now'> = systemClock
): Promise<NotifyAppointmentResult> {
	const ctx = getWorkerContext();
	const prepared = await step.run({ name: 'prepare-emails' }, async () => {
		const row = await findAppointment(ctx.db, input.appointmentId);
		if (!row || row.status === 'purged') return null;
		if (input.kind === 'pending' && row.status !== 'pending') return null;
		if (input.kind === 'confirmed' && row.status !== 'confirmed') return null;
		if (input.kind === 'video-chat-added') {
			if (!row.video_chat || row.video_chat !== input.videoChatUrl) return null;
			if (row.video_chat_request === 'suppress') return null;
			if (row.status !== 'pending' && row.status !== 'confirmed') return null;
		}
		const deliveries = await prepareAppointmentEmails(
			{ kind: input.kind, appointment: row },
			ctx.config
		);
		return { deliveries, videoChatUrl: row.video_chat };
	});
	if (!prepared || prepared.deliveries.length === 0) return null;

	const outcomes = await Promise.all(
		prepared.deliveries.map(({ role, envelope }) =>
			step.runWorkflow(
				deliverAppointmentEmail,
				{ appointmentId: input.appointmentId, kind: input.kind, role, envelope },
				{ name: `email:${role}` }
			)
		)
	);
	if (!outcomes.every((outcome) => outcome === 'sent')) return null;
	await step.run({ name: 'log:result' }, () =>
		appendEmailJobLog(ctx.db, input.appointmentId, 'done', clock.now().toISOString())
	);
	return { videoChatUrl: prepared.videoChatUrl };
}

export function registerNotifyAppointmentWorkflow(): void {
	implementObservedWorkflow(notifyAppointment, ({ input, step }) =>
		runNotifyAppointment(input, step)
	);
}
