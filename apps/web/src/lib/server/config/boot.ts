import { access } from 'node:fs/promises';
import { logger } from '../logger';

import { ConfigError, loadConfig, MissingEnvVarsError, resolveConfigPath } from '@when/config';
import type { WhenConfiguration } from '@when/config';

export async function bootConfig(path: string = resolveConfigPath()): Promise<WhenConfiguration> {
	const exists = await access(path).then(
		() => true,
		() => false
	);
	if (!exists) {
		logger.fatal(
			{ path },
			'config not found; copy config/when.example.yml to config/when.yaml as a starting point'
		);
		throw new Error(`config not found at ${path}`);
	}
	try {
		const cfg = await loadConfig(path);
		logger.info(
			{
				path,
				auth: 'oidc' in cfg.auth ? 'oidc' : 'credentials',
				calendars: cfg.calendars.map((c) => ({ name: c.name, type: c.type })),
				meetings: cfg.meetings.map((e) => ({
					name: e.name,
					slug: e.slug,
					flow: e.booking_approval
				}))
			},
			'config loaded'
		);
		return cfg;
	} catch (err) {
		if (err instanceof ConfigError) {
			logger.fatal({ path, issues: err.issues }, err.message);
		} else if (err instanceof MissingEnvVarsError) {
			logger.fatal({ path, missing: err.missing }, err.message);
		} else {
			logger.fatal({ path, err }, 'unexpected error loading config');
		}
		throw err;
	}
}
