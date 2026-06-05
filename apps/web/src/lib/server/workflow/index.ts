import { getOpenWorkflow, sendBookingEmail, type SendBookingEmailInput } from '@when/jobs';

export async function enqueueBookingEmail(input: SendBookingEmailInput): Promise<void> {
	await getOpenWorkflow().runWorkflow(sendBookingEmail, input, {
		idempotencyKey: `${input.appointment.id}:${input.kind}`
	});
}
