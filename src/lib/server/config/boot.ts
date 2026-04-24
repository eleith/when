import { join } from 'node:path';
import { logger } from '../logger';
import { configValid } from '../metrics';
import { ConfigError, loadConfigFile } from './load';
import { MissingEnvVarsError } from './interpolate';
import type { WhenConfiguration } from './schema';

export function defaultConfigPath(): string {
	if (process.env.NODE_ENV === 'production') return '/app/config.yaml';
	return join(process.cwd(), 'config.yaml');
}

export async function bootConfig(path: string = defaultConfigPath()): Promise<WhenConfiguration> {
	configValid.set(0);
	const file = Bun.file(path);
	if (!(await file.exists())) {
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
					flow: e.booking_flow
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
