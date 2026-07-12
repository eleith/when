import { existsSync } from 'node:fs';
import { define } from 'gunshi';
import { ConfigError, loadConfigFile, MissingEnvVarsError } from '@when/config';
import { getValidatedConfigPath } from '../../utils/config-path.ts';

export const validateCommand = define({
	name: 'validate',
	description: 'Validate the when.yaml file',
	async run(ctx) {
		const pathArg = ctx.positionals[ctx.commandPath.length];
		const path = getValidatedConfigPath(pathArg);

		if (!existsSync(path)) {
			if (pathArg) {
				console.error(`FAIL  No configuration file found at specified path: ${path}`);
			} else {
				console.error(`FAIL  No configuration file found at default paths.`);
				console.error(
					`      Please specify the path to your when.yaml (e.g., "when-cli config validate apps/web/config/when.yaml").`
				);
			}
			process.exitCode = 1;
			return;
		}

		try {
			await loadConfigFile(path);
			console.log(`OK  ${path}`);
		} catch (err) {
			if (err instanceof ConfigError) {
				console.error(`FAIL  ${path}`);
				for (const issue of err.issues) {
					console.error(`      ${issue.path}: ${issue.message}`);
				}
			} else if (err instanceof MissingEnvVarsError) {
				console.error(`FAIL  ${path}`);
				console.error(`      missing env vars: ${err.missing.join(', ')}`);
			} else {
				console.error(`FAIL  ${path}`);
				console.error(`      ${err instanceof Error ? err.message : String(err)}`);
			}
			process.exitCode = 1;
		}
	}
});
