import type { RetryPolicy } from 'openworkflow';
import { Temporal } from '@js-temporal/polyfill';
import { getOpenWorkflow } from '@when/jobs';
import { sendAppointmentEmail } from '@when/jobs/specs';
import type { SendAppointmentEmailInput, SendAppointmentEmailResult } from '@when/jobs';
import { dispatch } from '../email/dispatch.js';
import { getWorkerContext } from '../services/context.js';
import { appendJobLog } from '../services/job-log.js';

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
 * appointment email(s), sends each as a memoized + retried step, then records the
 * email outcome on the appointment. Side effects live only in `step.run`, so a
 * durable replay never re-sends something already sent.
 */
export async function runSendAppointmentEmail(
	input: SendAppointmentEmailInput,
	step: EmailStep
): Promise<SendAppointmentEmailResult> {
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
			logger.error('appointment email send failed after retries', {
				to: envelope.to,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	await step.run({ name: 'log:result' }, () =>
		appendJobLog(
			db,
			input.appointment.id,
			'email',
			allSent ? 'done' : 'failed',
			Temporal.Now.instant().toString()
		)
	);
	return allSent ? 'sent' : 'failed';
}

export function registerSendAppointmentEmailWorkflow(): void {
	getOpenWorkflow().implementWorkflow(sendAppointmentEmail, ({ input, step }) =>
		runSendAppointmentEmail(input, step)
	);
}
