import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const session = await locals.auth();
	if (!session) {
		throw redirect(303, `/signin?callbackUrl=${encodeURIComponent(url.pathname)}`);
	}
	return { session };
};
