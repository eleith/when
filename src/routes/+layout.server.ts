import { getConfig } from '$lib/server/state';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	const cfg = getConfig();
	const accent = cfg.user.branding?.accent_color;
	return {
		branding: {
			accent:
				accent == null
					? null
					: typeof accent === 'string'
						? { light: accent, dark: accent }
						: accent,
			logo_url: cfg.user.branding?.logo_url ?? null,
			favicon_url: cfg.user.branding?.favicon_url ?? null
		}
	};
};
