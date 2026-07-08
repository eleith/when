import { getConfig } from '$lib/server/state';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies }) => {
	const cfg = getConfig();
	return {
		appearance: {
			primary_light_color: cfg.user.appearance.primary_light_color,
			primary_dark_color: cfg.user.appearance.primary_dark_color,
			logo_url: cfg.user.appearance.logo_url ?? null,
			favicon_url: cfg.user.appearance.favicon_url ?? null
		},
		preferredTimezone: cookies.get('tz') ?? null
	};
};
