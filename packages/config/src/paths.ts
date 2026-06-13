import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function resolveConfigPath(): string {
	if (process.env.NODE_ENV === 'production') return '/app/config.yaml';

	const local = join(process.cwd(), 'config.yaml');
	if (existsSync(local)) return local;

	const root = join(process.cwd(), '..', '..', 'config.yaml');
	if (existsSync(root)) return root;

	return local;
}
