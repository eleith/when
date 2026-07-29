import { getConfig } from '$lib/server/state';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies }) => {
	const cfg = getConfig();
	return {
		appearance: {
			primary_light_color: cfg.user.appearance.primary_light_color,
			primary_dark_color: cfg.user.appearance.primary_dark_color,
			app_icon_url: cfg.user.appearance.app_icon_url,
			favicon_url: cfg.user.appearance.favicon_url,
			title: cfg.user.appearance.title,
			description: cfg.user.appearance.description
		},
		ogImage: `${cfg.url.app}${cfg.user.appearance.opengraph_url}`,
		preferredTimezone: cookies.get('tz') ?? null
	};
};
