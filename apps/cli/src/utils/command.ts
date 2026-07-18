import type { WhenConfiguration } from '@when/config';
import { requireConfigPath } from './config-path.ts';
import { loadConfigStructural } from './load.ts';

export async function loadConfigFromCtx(
	configArg: string | undefined
): Promise<WhenConfiguration | null> {
	const configPath = requireConfigPath(configArg);
	if (!configPath) return null;
	return loadConfigStructural(configPath);
}
