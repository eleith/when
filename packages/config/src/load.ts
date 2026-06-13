import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Ajv, { type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import schema from './config.schema.json' with { type: 'json' };
import externalSchema from './config.external.schema.json' with { type: 'json' };
import type { WhenConfiguration } from './schema.js';
import { interpolate } from './interpolate.js';
import { checkCrossRefs } from './cross-refs.js';
import { resolveConfigPath } from './paths.js';

// `schema` validates (ajv fills defaults); `externalSchema` is the relaxed copy
// editors point `$schema` at, so defaulted fields aren't flagged as missing.
export { schema, externalSchema };

const fillAjv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
addFormats(fillAjv);
const fillDefaults = fillAjv.compile(schema);

const validateAjv = new Ajv({ allErrors: true, strict: false });
addFormats(validateAjv);
const validateSchema = validateAjv.compile<WhenConfiguration>(schema);

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
	fillDefaults(withDefaults);
	const interpolated = interpolate(withDefaults) as WhenConfiguration;
	if (!validateSchema(interpolated)) {
		const issues = (validateSchema.errors ?? []).map(toIssue);
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
 * config.yaml) open the same files; `WHEN_DATABASE_PATH` / `WHEN_QUEUE_DB_PATH` override.
 */
function resolveDatabasePaths(config: WhenConfiguration, configPath: string): void {
	const dir = dirname(configPath);
	config.database.app = process.env.WHEN_DATABASE_PATH ?? resolve(dir, config.database.app);
	config.database.queue = process.env.WHEN_QUEUE_DB_PATH ?? resolve(dir, config.database.queue);
}

function toIssue(err: ErrorObject): ConfigIssue {
	const path = err.instancePath === '' ? '/' : err.instancePath;
	return { path, message: err.message ?? 'invalid' };
}
