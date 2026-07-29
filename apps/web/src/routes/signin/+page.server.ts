import { redirect } from '@sveltejs/kit';
import { isRedirect } from '@sveltejs/kit';
import { signInAction } from '$lib/server/auth';
import { localRedirect } from '$lib/server/redirect';
import { getConfig } from '$lib/server/state';
import { userLoginsTotal } from '$lib/server/metrics';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const callbackUrl = localRedirect(url.searchParams.get('callbackUrl'), url.origin, '/admin');
	const session = await locals.auth();
	if (session) redirect(303, callbackUrl);

	const cfg = getConfig();
	const authType = 'credentials' in cfg.auth ? 'credentials' : 'oidc';
	const errorCode = url.searchParams.get('error');

	return { callbackUrl, authType, errorCode };
};

export const actions: Actions = {
	default: async (event) => {
		const cfg = getConfig();
		const provider = 'credentials' in cfg.auth ? 'credentials' : 'oidc';
		try {
			const result = await signInAction(event);
			userLoginsTotal.inc({ provider, status: 'success' });
			return result;
		} catch (error) {
			if (isRedirect(error)) {
				userLoginsTotal.inc({ provider, status: 'success' });
				throw error;
			}

			userLoginsTotal.inc({ provider, status: 'failure' });

			const callbackUrl = localRedirect(
				event.url.searchParams.get('callbackUrl'),
				event.url.origin,
				'/admin'
			);
			let errorType = 'CredentialsSignin';

			if (error instanceof Error) {
				if ('type' in error && typeof error.type === 'string') {
					errorType = error.type;
				} else {
					errorType = error.name;
				}
			}

			redirect(
				303,
				`/signin?error=${encodeURIComponent(errorType)}&callbackUrl=${encodeURIComponent(callbackUrl)}`
			);
		}
	}
};
