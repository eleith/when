import Ajv, { type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import schema from '../../../../config.schema.json' with { type: 'json' };
import type { WhenConfiguration } from './schema';
import { interpolate } from './interpolate';
import { checkCrossRefs } from './cross-refs';

export { schema };

const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile<WhenConfiguration>(schema);

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
	const interpolated = interpolate(raw);
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

export async function loadConfigFile(path: string): Promise<WhenConfiguration> {
	const source = await Bun.file(path).text();
	let parsed: unknown;
	try {
		parsed = parseYaml(source);
	} catch (err) {
		throw new ConfigError(`${path} is not valid YAML`, [
			{ path: '/', message: err instanceof Error ? err.message : String(err) }
		]);
	}
	return validateConfig(parsed);
}

function toIssue(err: ErrorObject): ConfigIssue {
	const path = err.instancePath === '' ? '/' : err.instancePath;
	return { path, message: err.message ?? 'invalid' };
}
