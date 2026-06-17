import { sequence } from '@sveltejs/kit/hooks';
import { redirect, error } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { bootApp } from '$lib/server/boot';
import { logger } from '$lib/server/logger';

try {
	await bootApp();
} catch (err) {
	logger.fatal({ err }, 'boot failed — exiting');
	process.exit(1);
}

export const handle = sequence(getAuth().handle, async ({ event, resolve }) => {
	if (event.route.id?.startsWith('/(auth)')) {
		const session = await event.locals.auth();
		if (!session) {
			const accept = event.request.headers.get('accept') || '';
			if (event.request.method === 'GET' && accept.includes('text/html')) {
				const callbackUrl = event.url.pathname + event.url.search;
				throw redirect(303, `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
			} else {
				throw error(403, 'Not authorized.');
			}
		}
	}
	return resolve(event);
});
