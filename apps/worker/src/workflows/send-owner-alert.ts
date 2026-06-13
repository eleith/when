import type { RetryPolicy } from 'openworkflow';
import { getOpenWorkflow } from '@when/jobs';
import { sendOwnerAlert } from '@when/jobs/specs';
import type { SendOwnerAlertInput, SendOwnerAlertResult } from '@when/jobs';
import { ownerAlert } from '../email/builders/owner-alert.js';
import { fetchBrandLogo } from '../email/logo.js';
import { renderMessage } from '../email/render.js';
import { getWorkerContext } from '../services/context.js';

// Same per-step SMTP retry as the booking email: a send that fails every attempt
// is recorded (the result), not thrown as a workflow crash.
const SEND_RETRY: Partial<RetryPolicy> = {
	maximumAttempts: 5,
	initialInterval: '30s',
	backoffCoefficient: 2,
	maximumInterval: '10m'
};

interface EmailStep {
	run<T>(
		config: { name: string; retryPolicy?: Partial<RetryPolicy> },
		fn: () => Promise<T> | T
	): Promise<T>;
}

export async function runSendOwnerAlert(
	input: SendOwnerAlertInput,
	step: EmailStep
): Promise<SendOwnerAlertResult> {
	const { config, logger, mailer } = getWorkerContext();

	if (!config.smtp) {
		logger.warn('skipping owner alert: SMTP not configured', {
			calendarId: input.calendarId,
			kind: input.kind
		});
		return 'skipped';
	}

	const logo = await fetchBrandLogo(config);
	const envelope = renderMessage(ownerAlert(config, input, logo), logo);
	try {
		await step.run({ name: `smtp:${envelope.to}`, retryPolicy: SEND_RETRY }, async () => {
			const result = await mailer.send(envelope);
			if (!result.ok) throw new Error(result.reason);
		});
		return 'sent';
	} catch (err) {
		logger.error('owner alert send failed after retries', {
			calendarId: input.calendarId,
			error: err instanceof Error ? err.message : String(err)
		});
		return 'failed';
	}
}

export function registerSendOwnerAlertWorkflow(): void {
	getOpenWorkflow().implementWorkflow(sendOwnerAlert, ({ input, step }) =>
		runSendOwnerAlert(input, step)
	);
}
