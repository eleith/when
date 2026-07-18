import { interpolate, MissingEnvVarsError, type Service } from '@when/config';
import { loadConfigFromCtx } from '../../utils/command.ts';
import { fail } from '../../utils/report.ts';

// Resolve the config + required service name shared by every `service <action> <name>`.
export async function servicesAndName(
	nameArg: string | undefined,
	configArg: string | undefined,
	action: string
): Promise<{ services: Service[]; name: string } | null> {
	if (!nameArg) {
		fail(`service ${action} requires a service name`);
		return null;
	}
	const config = await loadConfigFromCtx(configArg);
	if (!config) return null;
	return { services: config.services ?? [], name: nameArg };
}

export function requireService(services: Service[], name: string): Service | null {
	const service = services.find((s) => s.name === name);
	if (!service) {
		fail(`no service named "${name}"`);
		return null;
	}
	return service;
}

export function resolveServiceEnv(service: Service): Service | null {
	try {
		return interpolate(service);
	} catch (err) {
		if (err instanceof MissingEnvVarsError) {
			fail(`${service.name} (${service.type}) — unset env var(s): ${err.missing.join(', ')}`);
			return null;
		}
		throw err;
	}
}
