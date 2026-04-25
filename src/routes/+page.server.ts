import { getConfig } from '$lib/server/state';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const cfg = getConfig();

	const eventTypes = cfg.event_types
		.filter((e) => (e.visibility ?? 'public') === 'public')
		.map((e) => ({
			id: e.id,
			name: e.name,
			slug: e.slug,
			duration: e.duration,
			description: e.description ?? null
		}));

	return {
		user: {
			name: cfg.user.name,
			branding: cfg.user.branding ?? null
		},
		eventTypes
	};
};
