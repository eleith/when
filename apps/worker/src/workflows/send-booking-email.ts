import type { RetryPolicy } from 'openworkflow';
import { getOpenWorkflow } from '@when/jobs';
import { sendBookingEmail } from '@when/jobs/specs';
import type { SendBookingEmailInput, SendBookingEmailResult } from '@when/jobs';
import { dispatch } from '../email/dispatch.js';
import { getWorkerContext } from '../services/context.js';
import { setNotificationStatus } from '../services/notifications.js';

// Retry the SMTP send itself (a memoized step), with backoff. A send that fails
// every attempt is an expected outcome we record, not a workflow crash.
const SEND_RETRY: Partial<RetryPolicy> = {
	maximumAttempts: 5,
	initialInterval: '30s',
	backoffCoefficient: 2,
	maximumInterval: '10m'
};

/** The slice of openworkflow's `step` the workflow body uses (keeps it testable). */
interface EmailStep {
	run<T>(
		config: { name: string; retryPolicy?: Partial<RetryPolicy> },
		fn: () => Promise<T> | T
	): Promise<T>;
}

/**
 * Workflow body, extracted so it can be tested with a fake `step`. Renders the
 * booking email(s), sends each as a memoized + retried step, then records the
 * email outcome on the appointment. Side effects live only in `step.run`, so a
 * durable replay never re-sends something already sent.
 */
export async function runSendBookingEmail(
	input: SendBookingEmailInput,
	step: EmailStep
): Promise<SendBookingEmailResult> {
	const { config, db, logger, mailer } = getWorkerContext();
	const envelopes = await dispatch(input, config);

	let allSent = true;
	for (const envelope of envelopes) {
		try {
			await step.run({ name: `smtp:${envelope.to}`, retryPolicy: SEND_RETRY }, async () => {
				const result = await mailer.send(envelope);
				if (!result.ok) throw new Error(result.reason);
			});
		} catch (err) {
			allSent = false;
			logger.error('booking email send failed after retries', {
				to: envelope.to,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	const outcome = allSent ? 'ok' : 'failed';
	await step.run({ name: 'status' }, () =>
		setNotificationStatus(db, input.appointment.id, 'email', outcome)
	);
	return allSent ? 'sent' : 'failed';
}

export function registerSendBookingEmailWorkflow(): void {
	getOpenWorkflow().implementWorkflow(sendBookingEmail, ({ input, step }) =>
		runSendBookingEmail(input, step)
	);
}
