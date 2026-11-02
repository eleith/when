import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ConfigPathOptions } from './options.js';

export function resolveConfigPath(options: ConfigPathOptions = {}): string {
	const env = options.env ?? process.env;
	const cwd = options.cwd ?? process.cwd();
	if (env.CONFIG_PATH) return env.CONFIG_PATH;
	if (env.NODE_ENV === 'production') return '/app/config/when.yaml';

	const local = join(cwd, 'config', 'when.yaml');
	if (existsSync(local)) return local;

	const root = join(cwd, '..', '..', 'config', 'when.yaml');
	if (existsSync(root)) return root;

	return local;
}

// config/, data/, and public/ are siblings under the deployment root, so it is the config dir's parent.
export function resolveDeploymentRoot(
	configPath?: string,
	options: ConfigPathOptions = {}
): string {
	// Keep the selected representation: a bare filename historically gives '.', not cwd's parent.
	return dirname(dirname(configPath ?? resolveConfigPath(options)));
}

// Server-only: reaches process.env/fs — client code must `import type`, never call this.
export function resolvePublicDir(configPath?: string, options: ConfigPathOptions = {}): string {
	const env = options.env ?? process.env;
	const cwd = options.cwd ?? process.cwd();
	const selectedPath = configPath ?? resolveConfigPath({ env, cwd });
	return env.WHEN_PUBLIC_DIR ?? resolve(cwd, resolveDeploymentRoot(selectedPath), 'public');
}
