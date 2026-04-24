import { bootConfig } from '$lib/server/config/boot';
import { logger } from '$lib/server/logger';

try {
	await bootConfig();
} catch (err) {
	logger.fatal({ err }, 'boot failed — exiting');
	process.exit(1);
}
