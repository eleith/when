import { getConfig } from '$lib/server/state';
import type { PageServerLoad } from './$types';
import { marked } from 'marked';

export const load: PageServerLoad = () => {
	const cfg = getConfig();

	const eventTypes = cfg.meetings
		.filter((e) => (e.visibility ?? 'public') === 'public')
		.map((e) => ({
			id: e.name,
			name: e.name,
			slug: e.slug,
			duration: e.duration_minutes,
			descriptionHtml: e.description ? marked.parse(e.description) : null,
			image_url: e.image_url ?? null
		}));

	return { eventTypes };
};
