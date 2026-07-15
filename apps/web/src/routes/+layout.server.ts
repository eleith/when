import { getConfig } from '$lib/server/state';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies }) => {
	const cfg = getConfig();
	const opengraphUrl = cfg.user.appearance.opengraph_url;
	return {
		appearance: {
			primary_light_color: cfg.user.appearance.primary_light_color,
			primary_dark_color: cfg.user.appearance.primary_dark_color,
			app_icon_url: cfg.user.appearance.app_icon_url,
			favicon_url: cfg.user.appearance.favicon_url,
			title: cfg.user.appearance.title,
			description: cfg.user.appearance.description
		},
		ogImage: opengraphUrl.startsWith('/') ? `${cfg.url.app}${opengraphUrl}` : opengraphUrl,
		preferredTimezone: cookies.get('tz') ?? null
	};
};
