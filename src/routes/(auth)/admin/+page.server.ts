import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	// hooks.server.ts redirects unauthenticated requests; if we reach here, the
	// session is set.
	const session = (await locals.auth())!;
	const csrfRes = await fetch('/auth/csrf');
	const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
	return { session, csrfToken };
};
