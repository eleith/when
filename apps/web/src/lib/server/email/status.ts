import type { WhenConfiguration } from '@when/config';
import { senderEmail } from '@when/config';
import { getOpenWorkflow, testEmail } from '@when/jobs';

const RESULT_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 3_000;

export interface SmtpView {
	host: string;
	port: number;
	user: string;
	sender: string;
	defaultRecipient: string;
}

export type SendResult = { ok: true; message: string } | { ok: false; message: string };

// Cheap: config only. Whether the credentials work is unknowable without sending, which
// is what the test action is for.
export function smtpSummary(config: WhenConfiguration): SmtpView {
	return {
		host: config.smtp.host,
		port: config.smtp.port,
		user: config.smtp.user,
		sender: senderEmail(config),
		defaultRecipient: config.user.email
	};
}

// Goes through the worker's real pipeline — the same workflow the CLI runs — so a pass
// proves templates, branding and SMTP credentials together, not just a socket.
//
// The worker is checked first because it is the one failure the queue cannot report: an
// unclaimed run just sits pending until the result poll times out half a minute later.
export async function sendTestEmail(config: WhenConfiguration, to: string): Promise<SendResult> {
	if (!to.trim()) return { ok: false, message: 'A recipient address is required.' };

	if (!(await workerReachable(config.url.worker))) {
		return { ok: false, message: 'The worker is not reachable, so nothing would send it.' };
	}

	try {
		const handle = await getOpenWorkflow().runWorkflow(
			testEmail,
			{ to },
			{ idempotencyKey: crypto.randomUUID() }
		);
		await handle.result({ timeoutMs: RESULT_TIMEOUT_MS });
		return { ok: true, message: `Test email sent to ${to}.` };
	} catch (err) {
		return { ok: false, message: err instanceof Error ? err.message : String(err) };
	}
}

async function workerReachable(workerUrl: string): Promise<boolean> {
	try {
		const res = await fetch(`${workerUrl.replace(/\/$/, '')}/healthz`, {
			signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
		});
		return res.ok;
	} catch {
		return false;
	}
}
