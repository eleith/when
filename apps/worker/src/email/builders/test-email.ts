import { senderEmail, type WhenConfiguration } from '@when/config';
import { deriveBrand, fmtInstant } from '../format.js';
import type { EmailContent } from '../content.js';
import type { Attachment, EmailMessage } from '../recipients.js';

const SAMPLE_QUESTION = 'What would you like to discuss in our meeting?';
const SAMPLE_ANSWER =
	'A long sample answer, included so you can see how a wide question label and a wrapping value render together before a guest sends you one.';

export function testEmailMessage(
	cfg: WhenConfiguration,
	to: string,
	logo: Attachment | null,
	now?: Temporal.Instant
): EmailMessage {
	const brand = deriveBrand(cfg, logo?.cid);
	const sentAt = (now ?? Temporal.Now.instant()).toString();
	const content: EmailContent = {
		brand,
		subject: `Test email from ${brand.name}`,
		heading: 'This is a test email from When',
		paragraphs: [
			'If you received this, When can render and send email using your SMTP settings.',
			'Triggered by `when-cli email test`.'
		],
		rows: [
			{ label: 'Sent to', value: to },
			{ label: 'Sent at', value: fmtInstant(sentAt, cfg.user.timezone) },
			{ label: 'Sends as', value: senderEmail(cfg) },
			{ label: SAMPLE_QUESTION, value: SAMPLE_ANSWER }
		],
		actions: [{ href: brand.appUrl, label: 'Open your booking page', variant: 'primary' }],
		previewText: 'When email test'
	};
	return { to, content };
}
