import type { Kysely } from 'kysely';
import { getOpenWorkflow, sendBookingEmail, type SendBookingEmailInput } from '@when/jobs';
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
