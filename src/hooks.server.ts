import { sequence } from '@sveltejs/kit/hooks';
import { getAuth } from '$lib/server/auth';
import { bootApp } from '$lib/server/boot';
import { logger } from '$lib/server/logger';

try {
	await bootApp();
} catch (err) {
	logger.fatal({ err }, 'boot failed — exiting');
	process.exit(1);
}

export const handle = sequence(getAuth().handle);
