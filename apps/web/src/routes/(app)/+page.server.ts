import { durationsOf } from '@when/config';
import { getConfig } from '$lib/server/state';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const session = await locals.auth();
	const isAdmin = !!session;
	const cfg = getConfig();

	const eventTypes = cfg.meetings
		.filter((e) => e.visibility === 'public')
		.map((e) => ({
			id: e.name,
			name: e.name,
			slug: e.slug,
			description: e.description ?? null,
			// Ascending for the card rail's span; config order marks the booking default, unused here.
			durations: durationsOf(e).toSorted((a, b) => a - b)
		}));

	return { eventTypes, isAdmin };
};
