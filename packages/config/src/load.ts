import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { FormatRegistry, type TSchema } from '@sinclair/typebox';
import { Value, type ValueError } from '@sinclair/typebox/value';
import * as schemas from './schema.js';
import { interpolate } from './interpolate.js';
import { withDerivedDefaults } from './normalize.js';
import { checkCrossRefs } from './cross-refs.js';
import { resolveConfigPath, resolveDeploymentRoot } from './paths.js';

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

	const interpolated = interpolate(withDefaults);
	const normalized = withDerivedDefaults(interpolated) as WhenConfiguration;
	const errors = [...Value.Errors(WhenConfigurationSchema, subschemas, normalized)];

	if (errors.length > 0) {
		const issues = errors.map(toIssue);
		throw new ConfigError(`config failed schema validation`, issues);
	}
	const crossRefIssues = checkCrossRefs(normalized);
	if (crossRefIssues.length > 0) {
		throw new ConfigError(`config failed cross-reference validation`, crossRefIssues);
	}
	return normalized;
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

// Resolve relative db paths against the deployment root, in place; env vars override.
function resolveDatabasePaths(config: WhenConfiguration, configPath: string): void {
	const root = resolveDeploymentRoot(configPath);
	config.database.app = process.env.WHEN_DATABASE_PATH ?? resolve(root, config.database.app);
	config.database.queue = process.env.WHEN_QUEUE_DB_PATH ?? resolve(root, config.database.queue);
}

function toIssue(err: ValueError): ConfigIssue {
	const path = err.path === '' ? '/' : err.path;
	return { path, message: err.message ?? 'invalid' };
}
