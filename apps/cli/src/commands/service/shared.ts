import type { Provider } from '@when/config';
import { loadConfigFromCtx } from '../../utils/command.ts';
import { fail } from '../../utils/report.ts';

// Resolve the config + required service name shared by every `service <action> <name>`.
export async function servicesAndName(
	nameArg: string | undefined,
	configArg: string | undefined,
	action: string
): Promise<{ services: Provider[]; name: string } | null> {
	if (!nameArg) {
		fail(`service ${action} requires a service name`);
		return null;
	}
	const config = await loadConfigFromCtx(configArg);
	if (!config) return null;
	return { services: config.providers ?? [], name: nameArg };
}

export function requireService(services: Provider[], name: string): Provider | null {
	const service = services.find((s) => s.name === name);
	if (!service) {
		fail(`no service named "${name}"`);
		return null;
	}
	return service;
}
