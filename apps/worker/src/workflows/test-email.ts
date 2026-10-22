import { testEmail } from '@when/jobs';
import type { TestEmailInput, TestEmailResult } from '@when/jobs';
import { getWorkerContext } from '../services/context.js';
import { fetchBrandLogo } from '../email/logo.js';
import { renderMessage } from '../email/render.js';
import { emailTheme } from '../email/theme.js';
import { recordSendOutcome } from '../email/status.js';
import { systemClock, type Clock } from '../email/clock.js';
import { testEmailMessage } from '../email/builders/test-email.js';
import { implementObservedWorkflow } from '../services/metrics.js';

export async function runTestEmail(
	input: TestEmailInput,
	clock: Pick<Clock, 'now'> = systemClock
): Promise<TestEmailResult> {
	const ctx = getWorkerContext();
	const logo = await fetchBrandLogo(ctx.config);
	const theme = emailTheme(ctx.config.user.appearance);
	const envelope = renderMessage(testEmailMessage(ctx.config, input.to, logo), logo, theme);
	const result = await ctx.mailer.send(envelope);
	const observedAt = clock.now().toISOString();
	await recordSendOutcome(ctx, result, observedAt);
	if (!result.ok) throw new Error(result.reason);
	return 'sent';
}

export function registerTestEmailWorkflow(): void {
	implementObservedWorkflow(testEmail, ({ input }) => runTestEmail(input));
}
