import { getConfig } from '$lib/server/state';
import type { PageServerLoad } from './$types';
import { marked } from 'marked';

export const load: PageServerLoad = () => {
	const cfg = getConfig();

	const eventTypes = cfg.event_types
		.filter((e) => (e.visibility ?? 'public') === 'public')
		.map((e) => ({
			id: e.id,
			name: e.name,
			slug: e.slug,
			duration: e.duration,
			descriptionHtml: e.description ? marked.parse(e.description) : null,
			image_url: e.image_url ?? null
		}));

	return { eventTypes };
};
