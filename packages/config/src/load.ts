import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { FormatRegistry, type TSchema } from '@sinclair/typebox';
import { Value, type ValueError } from '@sinclair/typebox/value';
import * as schemas from './schema.js';
import { interpolate } from './interpolate.js';
import { checkCrossRefs } from './cross-refs.js';
import { resolveConfigPath } from './paths.js';

const { WhenConfigurationSchema } = schemas;
type WhenConfiguration = schemas.WhenConfiguration;

// Register formats for runtime validation using TypeBox
FormatRegistry.Set('email', (value) => {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
});

FormatRegistry.Set('uri', (value) => {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
});

// Gather all subschemas so TypeBox can dereference refs during Value.Check / Value.Default
const subschemas = Object.entries(schemas)
	.filter(([key]) => key.endsWith('Schema') && key !== 'WhenConfigurationSchema')
	.map(([_, val]) => val as unknown as TSchema);

export interface ConfigIssue {
	path: string;
	message: string;
}

export class ConfigError extends Error {
	readonly issues: readonly ConfigIssue[];
	constructor(message: string, issues: ConfigIssue[]) {
		super(`${message}\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
		this.name = 'ConfigError';
		this.issues = issues;
	}
}

export function validateConfig(raw: unknown): WhenConfiguration {
	const withDefaults = structuredClone(raw) ?? {};
	Value.Default(WhenConfigurationSchema, subschemas, withDefaults);

	const interpolated = interpolate(withDefaults) as WhenConfiguration;
	const errors = [...Value.Errors(WhenConfigurationSchema, subschemas, interpolated)];

	if (errors.length > 0) {
		const issues = errors.map(toIssue);
		throw new ConfigError(`config failed schema validation`, issues);
	}
	const crossRefIssues = checkCrossRefs(interpolated);
	if (crossRefIssues.length > 0) {
		throw new ConfigError(`config failed cross-reference validation`, crossRefIssues);
	}
	return interpolated;
}

export async function loadConfigFile(
	path: string = resolveConfigPath()
): Promise<WhenConfiguration> {
	const source = await readFile(path, 'utf8');
	let parsed: unknown;
	try {
		parsed = parseYaml(source);
	} catch (err) {
		throw new ConfigError(`${path} is not valid YAML`, [
			{ path: '/', message: err instanceof Error ? err.message : String(err) }
		]);
	}
	const config = validateConfig(parsed);
	resolveDatabasePaths(config, path);
	return config;
}

/**
 * Resolve the database paths to absolute, in place. Relative paths are taken
 * against the config file's directory so web and worker (sharing one
 * when.yaml) open the same files; `WHEN_DATABASE_PATH` / `WHEN_QUEUE_DB_PATH` override.
 */
function resolveDatabasePaths(config: WhenConfiguration, configPath: string): void {
	const dir = dirname(configPath);
	config.database.app = process.env.WHEN_DATABASE_PATH ?? resolve(dir, config.database.app);
	config.database.queue = process.env.WHEN_QUEUE_DB_PATH ?? resolve(dir, config.database.queue);
}

function toIssue(err: ValueError): ConfigIssue {
	const path = err.path === '' ? '/' : err.path;
	return { path, message: err.message ?? 'invalid' };
}
