import { join } from 'node:path';
import { Eta } from 'eta';
import type { EmailContent } from './content.js';
import type { Attachment, EmailMessage, Envelope } from './recipients.js';
import type { EmailTheme } from './theme.js';

const views = join(import.meta.dirname, 'templates');
const cache = process.env.NODE_ENV === 'production';
const htmlEta = new Eta({ views, autoEscape: true, cache });
const textEta = new Eta({ views, autoEscape: false, autoTrim: false, cache });

export function renderHtmlBody(content: EmailContent, theme: EmailTheme): string {
	return htmlEta.render('email.html.eta', { ...content, theme });
}

export function renderTextBody(content: EmailContent): string {
	return textEta.render('email.txt.eta', content).trim();
}

/** Render a builder's message into a send-ready envelope, attaching ics + brand logo. */
export function renderMessage(
	message: EmailMessage,
	logo: Attachment | null,
	theme: EmailTheme
): Envelope {
	const { to, content, ics } = message;
	const attachments = [...(ics ? [ics] : []), ...(logo ? [logo] : [])];
	return {
		to,
		subject: content.subject,
		html: renderHtmlBody(content, theme),
		text: renderTextBody(content),
		attachments: attachments.length ? attachments : undefined
	};
}
