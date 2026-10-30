import { redirect } from '@sveltejs/kit';
import { localRedirect } from '#lib/server/redirect.js';
import { getConfig } from '#lib/server/state.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const callbackUrl = localRedirect(url.searchParams.get('callbackUrl'), url.origin, '/admin');
	const session = await locals.auth();
	if (session) redirect(303, callbackUrl);

	const cfg = getConfig();
	const auth = cfg.auth.oidc
		? { type: 'oidc' as const, name: cfg.auth.oidc.name }
		: { type: 'credentials' as const };
	const errorCode = url.searchParams.get('error');

	return { callbackUrl, auth, errorCode };
};
