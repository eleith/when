import { getConfig } from '$lib/server/state';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const cfg = getConfig();

	const eventTypes = cfg.meetings
		.filter((e) => (e.visibility ?? 'public') === 'public')
		.map((e) => ({
			id: e.name,
			name: e.name,
			slug: e.slug,
			duration: e.duration_minutes,
			description: e.description ?? null
		}));

	return { eventTypes };
};
