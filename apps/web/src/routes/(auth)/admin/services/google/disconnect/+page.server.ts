import { error } from '@sveltejs/kit';
import { getConfig } from '$lib/server/state';
import {
	disconnectGoogle,
	findGoogleProvider,
	refreshTokenEnvVar
} from '$lib/server/providers/google-connect';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request }) => {
		const name = String((await request.formData()).get('provider') ?? '');
		const provider = findGoogleProvider(getConfig(), name);
		if (!provider) error(404, `No google provider named "${name}".`);

		const result = await disconnectGoogle(provider);
		return {
			service: name,
			envVar: refreshTokenEnvVar(name),
			revoked: result.revoked,
			reason: result.reason ?? null
		};
	}
};
