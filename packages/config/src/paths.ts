import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function resolveConfigPath(): string {
	if (process.env.CONFIG_PATH) return process.env.CONFIG_PATH;
	if (process.env.NODE_ENV === 'production') return '/app/config/when.yaml';

	const local = join(process.cwd(), 'config', 'when.yaml');
	if (existsSync(local)) return local;

	const root = join(process.cwd(), '..', '..', 'config', 'when.yaml');
	if (existsSync(root)) return root;

	return local;
}

// config/, data/, and public/ are siblings under the deployment root, so it is the config dir's parent.
export function resolveDeploymentRoot(configPath: string = resolveConfigPath()): string {
	return dirname(dirname(configPath));
}

// Server-only: reaches process.env/fs — client code must `import type`, never call this.
export function resolvePublicDir(configPath: string = resolveConfigPath()): string {
	return process.env.WHEN_PUBLIC_DIR ?? resolve(resolveDeploymentRoot(configPath), 'public');
}
