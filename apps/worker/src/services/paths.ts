import { join } from 'node:path';

/**
 * Path to the worker's `config.yaml`. Production uses the container's
 * `/app/config.yaml`; in dev it's `<cwd>/config.yaml` (the compose mount, or set
 * `CONFIG_PATH` when running the worker directly from the repo).
 */
export function resolveConfigPath(): string {
	if (process.env.CONFIG_PATH) return process.env.CONFIG_PATH;
	if (process.env.NODE_ENV === 'production') return '/app/config.yaml';
	return join(process.cwd(), 'config.yaml');
}
