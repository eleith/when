import { getConfig } from '$lib/server/state';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	const cfg = getConfig();
	return {
		branding: {
			accent_color: cfg.user.branding?.accent_color ?? null,
			logo_url: cfg.user.branding?.logo_url ?? null
		}
	};
};
