import mjml2html from 'mjml';

/**
 * Compile an assembled MJML document to email-ready HTML. MJML owns the
 * bulletproof, table-based, inline-styled output; we only call it.
 *
 * `validationLevel: 'soft'` collects problems in `errors` rather than throwing
 * mid-parse — we then throw ourselves, because a malformed template is a bug,
 * not a soft warning. (`mj-include` stays disabled by default; Eta does our
 * layout/partials, so MJML never needs to read other files.)
 */
export async function compileMjml(mjml: string): Promise<string> {
	const { html, errors } = await mjml2html(mjml, { validationLevel: 'soft' });
	if (errors.length > 0) {
		const detail = errors.map((e) => e.formattedMessage).join('\n');
		throw new Error(`MJML compile errors:\n${detail}`);
	}
	return html;
}
