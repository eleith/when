import { durationsOf } from '@when/config';
import { getConfig } from '$lib/server/state';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const session = await locals.auth();
	const isAdmin = !!session;
	const cfg = getConfig();

	const eventTypes = Object.entries(cfg.meetings)
		.filter(([, e]) => e.visibility === 'public')
		.map(([slug, e]) => ({
			id: slug,
			name: e.title,
			slug,
			description: e.description ?? null,
			// Ascending for the card rail's span.
			durations: durationsOf(e).toSorted((a, b) => a - b)
		}));

	return { eventTypes, isAdmin };
};
