import { join } from 'node:path';
import { Eta } from 'eta';
import type { EmailContent } from './content.js';
import type { Attachment, EnvelopeSpec } from './recipients.js';

const views = join(import.meta.dirname, 'templates');
const htmlEta = new Eta({ views, autoEscape: true, cache: true });
const textEta = new Eta({ views, autoEscape: false, autoTrim: false, cache: true });

export function renderHtmlBody(content: EmailContent): string {
	return htmlEta.render('email.html.eta', content);
}

export function renderTextBody(content: EmailContent): string {
	return textEta.render('email.txt.eta', content).trim();
}

export function toSpec(content: EmailContent, subject: string, ics?: Attachment): EnvelopeSpec {
	return { subject, html: renderHtmlBody(content), text: renderTextBody(content), ics };
}
