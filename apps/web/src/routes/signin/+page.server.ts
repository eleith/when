import { redirect } from '@sveltejs/kit';
import { isRedirect } from '@sveltejs/kit';
import { signInAction } from '$lib/server/auth';
import { getConfig } from '$lib/server/state';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const callbackUrl = url.searchParams.get('callbackUrl') ?? '/admin';
	if (await locals.auth()) redirect(303, callbackUrl);

	const cfg = getConfig();
	const authType = 'credentials' in cfg.auth ? 'credentials' : 'oidc';
	const errorCode = url.searchParams.get('error');

	return { callbackUrl, authType, errorCode };
};

export const actions: Actions = {
	default: async (event) => {
		try {
			return await signInAction(event);
		} catch (error: any) {
			if (isRedirect(error)) {
				throw error;
			}

			const callbackUrl = event.url.searchParams.get('callbackUrl') ?? '/admin';
			let errorType = 'CredentialsSignin';
			
			if (error && typeof error === 'object') {
				if (error.type) {
					errorType = error.type;
				} else if (error.constructor?.name) {
					errorType = error.constructor.name;
				}
			}

			redirect(303, `/signin?error=${encodeURIComponent(errorType)}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
		}
	}
};
