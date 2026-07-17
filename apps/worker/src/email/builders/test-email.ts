import { deriveBrand } from '../format.js';
import type { EmailContent } from '../content.js';
import type { Attachment, EmailMessage } from '../recipients.js';
import type { WhenConfiguration } from '@when/config';

export function testEmailMessage(
	cfg: WhenConfiguration,
	to: string,
	logo: Attachment | null
): EmailMessage {
	const brand = deriveBrand(cfg, logo?.cid);
	const content: EmailContent = {
		brand,
		subject: `Test email from ${brand.name}`,
		heading: 'This is a test email from When',
		paragraphs: [
			'If you received this, When can render and send email using your SMTP settings.',
			'Triggered by `when-cli email test`.'
		],
		rows: [],
		actions: [],
		previewText: 'When email test'
	};
	return { to, content };
}
