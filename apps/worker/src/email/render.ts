import { join } from 'node:path';
import { Eta } from 'eta';
import { compileMjml } from './mjml.js';

// Templates live next to this module (src/email/templates in dev/test, copied to
// dist/src/email/templates by `build:assets` at build), so import.meta.dirname
// resolves them in both. A builder renders the same `name` + `data` through both
// functions to get the html and text bodies of one email — they can't drift.
const views = join(import.meta.dirname, 'templates');

// HTML: auto-escape interpolated data (it lands in markup).
const htmlEta = new Eta({ views, autoEscape: true, cache: true });

// Text: no escaping (plain text) and no trimming, so line breaks are exactly what
// the template writes (use Eta's `-%>` to slurp newlines after control tags).
const textEta = new Eta({ views, autoEscape: false, autoTrim: false, cache: true });

/** Render `<name>.mjml.eta` (Eta → MJML) to email HTML. */
export async function renderHtmlBody(name: string, data: Record<string, unknown>): Promise<string> {
	const mjml = htmlEta.render(`${name}.mjml.eta`, data);
	return compileMjml(mjml);
}

/** Render `<name>.txt.eta` (Eta) to the plain-text email body. */
export async function renderTextBody(name: string, data: Record<string, unknown>): Promise<string> {
	return textEta.render(`${name}.txt.eta`, data).trim();
}
