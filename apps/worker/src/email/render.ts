import { join } from 'node:path';
import { Eta } from 'eta';
import type { EmailContent } from './content.js';
import type { Attachment, EmailMessage, Envelope } from './recipients.js';

const views = join(import.meta.dirname, 'templates');
const htmlEta = new Eta({ views, autoEscape: true, cache: true });
const textEta = new Eta({ views, autoEscape: false, autoTrim: false, cache: true });

export function renderHtmlBody(content: EmailContent): string {
	return htmlEta.render('email.html.eta', content);
}

export function renderTextBody(content: EmailContent): string {
	return textEta.render('email.txt.eta', content).trim();
}

/** Render a builder's message into a send-ready envelope, attaching ics + brand logo. */
export function renderMessage(message: EmailMessage, logo: Attachment | null): Envelope {
	const { to, content, ics } = message;
	const attachments = [...(ics ? [ics] : []), ...(logo ? [logo] : [])];
	return {
		to,
		subject: content.subject,
		html: renderHtmlBody(content),
		text: renderTextBody(content),
		attachments: attachments.length ? attachments : undefined
	};
}
