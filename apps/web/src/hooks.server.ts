import { sequence } from '@sveltejs/kit/hooks';
import { redirect, error, type Handle } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { localRedirect } from '$lib/server/redirect';
import { bootApp } from '$lib/server/boot';
import { logger } from '$lib/server/logger';
import { getConfig } from '$lib/server/state';
import { themeStyleTag } from '$lib/server/appearance';

try {
	await bootApp();
} catch (err) {
	logger.fatal({ err }, 'boot failed — exiting');
	process.exit(1);
}

export const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	response.headers.set('x-content-type-options', 'nosniff');
	return response;
};

export const authGate: Handle = async ({ event, resolve }) => {
	if (event.route.id?.startsWith('/(auth)')) {
		const session = await event.locals.auth();
		if (!session) {
			const accept = event.request.headers.get('accept') || '';
			if (event.request.method === 'GET' && accept.includes('text/html')) {
				const callbackUrl = localRedirect(
					event.url.pathname + event.url.search,
					event.url.origin,
					'/admin'
				);
				throw redirect(303, `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
			} else {
				throw error(403, 'Not authorized.');
			}
		}
	}

	const cfg = getConfig();
	const appearance = cfg.user.appearance;

	return resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace('</head>', `\t${themeStyleTag(appearance)}\n</head>`)
	});
};

export const handle = sequence(securityHeaders, getAuth().handle, authGate);
