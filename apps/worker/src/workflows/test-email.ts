import { testEmail } from '@when/jobs';
import type { TestEmailInput, TestEmailResult } from '@when/jobs';
import { getWorkerContext } from '../services/context.js';
import { fetchBrandLogo } from '../email/logo.js';
import { renderMessage } from '../email/render.js';
import { testEmailMessage } from '../email/builders/test-email.js';
import { implementObservedWorkflow } from '../services/metrics.js';

export async function runTestEmail(input: TestEmailInput): Promise<TestEmailResult> {
	const ctx = getWorkerContext();
	const logo = await fetchBrandLogo(ctx.config);
	const envelope = renderMessage(testEmailMessage(ctx.config, input.to, logo), logo);
	const result = await ctx.mailer.send(envelope);
	if (!result.ok) throw new Error(result.reason);
	return 'sent';
}

export function registerTestEmailWorkflow(): void {
	implementObservedWorkflow(testEmail, ({ input }) => runTestEmail(input));
}
