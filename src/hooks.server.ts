import { bootApp } from '$lib/server/boot';
import { logger } from '$lib/server/logger';

try {
	await bootApp();
} catch (err) {
	logger.fatal({ err }, 'boot failed — exiting');
	process.exit(1);
}
