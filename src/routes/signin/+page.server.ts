import { redirect } from '@sveltejs/kit';
import { signInAction } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const callbackUrl = url.searchParams.get('callbackUrl') ?? '/admin';
	if (await locals.auth()) redirect(303, callbackUrl);
	return { callbackUrl };
};

export const actions: Actions = {
	default: signInAction
};
