import { access } from 'node:fs/promises';
import { logger } from '../logger';
import { configValid } from '../metrics';
import { ConfigError, loadConfigFile, MissingEnvVarsError, resolveConfigPath } from '@when/config';
import type { WhenConfiguration } from '@when/config';

export async function bootConfig(path: string = resolveConfigPath()): Promise<WhenConfiguration> {
	configValid.set(0);
	const exists = await access(path).then(
		() => true,
		() => false
	);
	if (!exists) {
		logger.fatal(
			{ path },
			'config.yaml not found; copy config.example.yaml from the repo as a starting point'
		);
		throw new Error(`config not found at ${path}`);
	}
	try {
		const cfg = await loadConfigFile(path);
		configValid.set(1);
		logger.info(
			{
				path,
				auth: 'oidc' in cfg.auth ? 'oidc' : 'credentials',
				calendars: cfg.calendars.map((c) => ({ id: c.id, type: c.type })),
				event_types: cfg.event_types.map((e) => ({
					id: e.id,
					slug: e.slug,
					flow: e.appointment_flow
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
