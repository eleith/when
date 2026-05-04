import { getConfig } from '$lib/server/state';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	const cfg = getConfig();
	const primary = cfg.user.branding?.primary_color;
	return {
		branding: {
			primary:
				primary == null
					? null
					: typeof primary === 'string'
						? { light: primary, dark: primary }
						: primary,
			logo_url: cfg.user.branding?.logo_url ?? null,
			favicon_url: cfg.user.branding?.favicon_url ?? null
		}
	};
};
