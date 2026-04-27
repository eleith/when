import { signInAction } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({
	callbackUrl: url.searchParams.get('callbackUrl') ?? '/admin'
});

export const actions: Actions = {
	default: signInAction
};
