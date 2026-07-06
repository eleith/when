import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveConfigPath } from '@when/config';

export function getValidatedConfigPath(pathArg?: string): string {
	const baseDir = process.env.INIT_CWD ?? process.cwd();

	if (pathArg) {
		return resolve(baseDir, pathArg);
	}

	// Try default paths relative to invocation directory
	const localPath = resolve(baseDir, 'config.yaml');
	if (existsSync(localPath)) return localPath;

	const appsWebPath = resolve(baseDir, 'apps/web/config.yaml');
	if (existsSync(appsWebPath)) return appsWebPath;

	// Fallback
	return resolveConfigPath();
}

export function validateConfigExists(configPath: string): boolean {
	if (!existsSync(configPath)) {
		console.error(`FAIL  No configuration file found at: ${configPath}`);
		console.error(
			`      Please specify the path to your config.yaml using --config (e.g., "--config apps/web/config.yaml").`
		);
		process.exitCode = 1;
		return false;
	}
	return true;
}
