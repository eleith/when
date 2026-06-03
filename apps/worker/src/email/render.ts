import { join } from 'node:path';
import { Eta } from 'eta';
import { compileMjml } from './mjml.js';

// Templates live next to this module (src/email/templates in dev/test, copied to
// dist/src/email/templates by `build:assets` at build), so import.meta.dirname
// resolves them in both.
const eta = new Eta({
	views: join(import.meta.dirname, 'templates'),
	autoEscape: true,
	cache: true
});

/**
 * Render a `.mjml` template to email HTML: Eta assembles the document (layout +
 * partials + escaped data), then MJML compiles it. `data` is the presentation
 * input the per-kind builder prepared.
 */
export async function renderEmail(
	template: string,
	data: Record<string, unknown>
): Promise<string> {
	const mjml = eta.render(template, data);
	return compileMjml(mjml);
}
