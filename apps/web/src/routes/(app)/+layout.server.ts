import { getConfig } from '$lib/server/state';
import type { LayoutServerLoad } from './$types';
import { marked } from 'marked';

export const load: LayoutServerLoad = () => {
	const cfg = getConfig();
	const raw = cfg.user.appearance;

	return {
		user: {
			name: cfg.user.name,
			timezone: cfg.user.timezone,
			appearance: raw
				? {
						...raw,
						descriptionHtml: raw.description ? marked.parse(raw.description) : null
					}
				: null
		}
	};
};
