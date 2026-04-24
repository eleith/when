import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, url }) => {
	const csrfRes = await fetch('/auth/csrf');
	const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
	return {
		csrfToken,
		callbackUrl: url.searchParams.get('callbackUrl') ?? '/admin'
	};
};
