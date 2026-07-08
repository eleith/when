import { getConfig } from '$lib/server/state';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	const cfg = getConfig();
	return {
		user: {
			name: cfg.user.name,
			timezone: cfg.user.timezone,
			appearance: cfg.user.appearance
		}
	};
};
