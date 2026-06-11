import type { Kysely } from 'kysely';
import {
	getOpenWorkflow,
	sendBookingEmail,
	publishNow,
	type SendBookingEmailInput
} from '@when/jobs';
import type { Appointment, Database } from '@when/db';

export async function enqueueBookingEmail(
	db: Kysely<Database>,
	input: SendBookingEmailInput
): Promise<Appointment> {
	await db
		.updateTable('appointments')
		.set({ email_notification_status: 'queued' })
		.where('id', '=', input.appointment.id)
		.execute();
	await getOpenWorkflow().runWorkflow(sendBookingEmail, input, {
		idempotencyKey: `${input.appointment.id}:${input.kind}`
	});
	return { ...input.appointment, email_notification_status: 'queued' };
}

// Wake the worker's publish scan. A unique key per call so each booking change
// triggers a scan (the scan re-reads the DB, so duplicates are harmless and the
// scanner collapses bursts).
export async function enqueuePublishKick(): Promise<void> {
	await getOpenWorkflow().runWorkflow(
		publishNow,
		{},
		{ idempotencyKey: `publish-now:${crypto.randomUUID()}` }
	);
}
