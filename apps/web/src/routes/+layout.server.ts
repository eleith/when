import { getConfig } from '$lib/server/state';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies }) => {
	const cfg = getConfig();
	return {
		branding: {
			primary: cfg.user.branding.color.primary,
			logo_url: cfg.user.branding.logo_url ?? null,
			favicon_url: cfg.user.branding.favicon_url ?? null
		},
		preferredTimezone: cookies.get('tz') ?? null
	};
};
