import { existsSync, readFileSync } from 'node:fs';
import { define } from 'gunshi';
import {
	ConfigError,
	loadConfigFile,
	loadConfigFileStructure,
	locateInYaml,
	MissingEnvVarsError,
	type ConfigIssue
} from '@when/config';
import { getValidatedConfigPath } from '../../utils/config-path.ts';
import { pass, fail, detail } from '../../utils/report.ts';

export const validateCommand = define({
	name: 'validate',
	description: 'Validate the when.yaml file',
	args: {
		config: {
			type: 'string',
			short: 'c',
			description: 'Path to when.yaml file'
		},
		'check-env': {
			type: 'boolean',
			description: 'Also check that referenced environment variables are set (full boot check).'
		}
	},
	async run(ctx) {
		const pathArg = ctx.values?.config ?? ctx.positionals[ctx.commandPath.length];
		const path = getValidatedConfigPath(pathArg);
		const checkEnv = ctx.values?.['check-env'] === true;

		if (!existsSync(path)) {
			reportMissingFile(path, pathArg);
			return;
		}

		try {
			await (checkEnv ? loadConfigFile(path) : loadConfigFileStructure(path));
			pass(path);
		} catch (err) {
			reportConfigError(path, err);
		}
	}
});

function reportIssues(path: string, issues: readonly ConfigIssue[]): void {
	const text = readFileSync(path, 'utf8');
	const located = issues.map((issue) => ({
		at: locateInYaml(text, issue.path),
		message: issue.message
	}));
	const width = Math.max(...located.map((l) => (l.at ? `${l.at.line}:${l.at.column}`.length : 0)));

	for (const { at, message } of located) {
		if (!at) {
			detail(message);
			continue;
		}
		const where = `${at.line}:${at.column}`.padEnd(width);
		detail(`${where}  ${at.missing ? `${at.missing}: ` : ''}${message}`);
	}
}

function reportMissingFile(path: string, pathArg: string | undefined): void {
	if (pathArg) {
		fail(`no config file found at ${path}`);
		return;
	}
	fail('no config file found at default paths');
	detail('pass the path, e.g. when-cli config validate apps/web/config/when.yaml');
}

function reportConfigError(path: string, err: unknown): void {
	fail(path);
	if (err instanceof ConfigError) {
		reportIssues(path, err.issues);
	} else if (err instanceof MissingEnvVarsError) {
		detail(`missing env vars: ${err.missing.join(', ')}`);
	} else {
		detail(err instanceof Error ? err.message : String(err));
	}
}
