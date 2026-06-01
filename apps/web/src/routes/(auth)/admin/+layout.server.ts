import { getConfig } from '$lib/server/state';
import type { WhenConfiguration } from '@when/config';
import type { LayoutServerLoad } from './$types';

function sanitizeConfig(cfg: WhenConfiguration): unknown {
	const s = JSON.parse(JSON.stringify(cfg));
	if ('credentials' in s.auth) s.auth.credentials.password_hash = '***';
	if ('oidc' in s.auth) s.auth.oidc.client_secret = '***';
	if (s.smtp) s.smtp.pass = '***';
	for (const cal of s.calendars) {
		if (cal.type === 'caldav') cal.password = '***';
		if (cal.type === 'google') cal.client_secret = '***';
	}
	return s;
}

export const load: LayoutServerLoad = async ({ locals }) => {
	const session = (await locals.auth())!;
	const cfg = getConfig();
	return { session, config: sanitizeConfig(cfg) };
};
