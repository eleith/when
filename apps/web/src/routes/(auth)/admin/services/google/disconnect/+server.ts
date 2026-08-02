import { redirect, error } from '@sveltejs/kit';
import { getConfig, getDb } from '$lib/server/state';
import { disconnectGoogle, findGoogleProvider } from '$lib/server/providers/google-connect';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const name = String((await request.formData()).get('provider') ?? '');
	if (!findGoogleProvider(getConfig(), name)) error(404, `No google provider named "${name}".`);

	await disconnectGoogle(getDb(), name);
	redirect(303, '/admin/health');
};
