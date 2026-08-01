import type { Kysely } from 'kysely';
import type { WhenConfiguration } from '@when/config';
import { senderEmail } from '@when/config';
import { listServiceStatus, type Database } from '@when/db';
import { getOpenWorkflow, testEmail } from '@when/jobs';
import { observedFrom, type ObservedView } from '$lib/server/observed';
import { workerReachable } from '$lib/server/worker';

const RESULT_TIMEOUT_MS = 30_000;

export interface SmtpView {
	host: string;
	port: number;
	user: string;
	sender: string;
	defaultRecipient: string;
	observed: ObservedView;
}

export type SendResult = { ok: true; message: string } | { ok: false; message: string };

export async function smtpSummary(
	config: WhenConfiguration,
	db: Kysely<Database>
): Promise<SmtpView> {
	const [status] = await listServiceStatus(db, 'smtp');
	return {
		host: config.smtp.host,
		port: config.smtp.port,
		user: config.smtp.user,
		sender: senderEmail(config),
		defaultRecipient: config.user.email,
		observed: observedFrom(status)
	};
}

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
