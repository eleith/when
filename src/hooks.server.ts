import { sequence } from '@sveltejs/kit/hooks';
import { redirect, type Handle } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { bootApp } from '$lib/server/boot';
import { logger } from '$lib/server/logger';

try {
	await bootApp();
} catch (err) {
	logger.fatal({ err }, 'boot failed — exiting');
	process.exit(1);
}

const guardAdmin: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/admin')) {
		const session = await event.locals.auth();
		if (!session)
			throw redirect(303, `/signin?callbackUrl=${encodeURIComponent(event.url.pathname)}`);
	}
	return resolve(event);
};

export const handle = sequence(getAuth().handle, guardAdmin);
