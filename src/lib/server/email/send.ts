import type { WhenConfiguration } from '../config/schema';
import { sendEmail } from '../smtp';

export interface Attachment {
	filename: string;
	content: string;
	contentType: string;
}

export interface Envelope {
	to: string;
	subject: string;
	text: string;
	html?: string;
	attachments?: Attachment[];
}

export interface SendResult {
	ok: boolean;
	skipped: boolean;
}

const SKIP: SendResult = { ok: true, skipped: true };

/**
 * Send a batch of email envelopes. Skips entirely (ok) when SMTP isn't configured,
 * otherwise dispatches them in parallel and aggregates the result.
 */
export async function sendEmails(
	cfg: WhenConfiguration,
	envelopes: Envelope[]
): Promise<SendResult> {
	if (!cfg.smtp) return SKIP;
	const results = await Promise.all(envelopes.map((e) => sendEmail(e)));
	return { ok: results.every((r) => r.ok), skipped: false };
}
