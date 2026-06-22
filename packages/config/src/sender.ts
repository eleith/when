import type { WhenConfiguration } from './schema.js';

function hostFromUrl(u: string | undefined): string | null {
	if (!u) return null;
	try {
		const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `http://${u}`;
		return new URL(withScheme).hostname || null;
	} catch {
		return null;
	}
}

/**
 * The address shown to guests as both the email From and the calendar organizer.
 * Uses the configured `smtp.from`, otherwise `noreply@` the app's public domain
 * (falling back to the SMTP host). Never the host's own `user.email`.
 */
export function senderEmail(cfg: Pick<WhenConfiguration, 'smtp' | 'url'>): string {
	if (cfg.smtp.from) return cfg.smtp.from;
	const domain = hostFromUrl(cfg.url?.app) ?? cfg.smtp.host;
	return `noreply@${domain}`;
}
