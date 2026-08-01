import type { Provider } from '@when/config';
import { loadConfigFromCtx } from '../../utils/command.ts';
import { fail } from '../../utils/report.ts';

// Resolve the config + required provider name shared by every `provider <action> <name>`.
export async function providersAndName(
	nameArg: string | undefined,
	configArg: string | undefined,
	action: string
): Promise<{ providers: Provider[]; name: string } | null> {
	if (!nameArg) {
		fail(`provider ${action} requires a provider name`);
		return null;
	}
	const config = await loadConfigFromCtx(configArg);
	if (!config) return null;
	return { providers: config.providers ?? [], name: nameArg };
}

export function requireProvider(providers: Provider[], name: string): Provider | null {
	const provider = providers.find((s) => s.name === name);
	if (!provider) {
		fail(`no provider named "${name}"`);
		return null;
	}
	return provider;
}
