import { interpolate, MissingEnvVarsError, type Service } from '@when/config';
import { fail } from '../../utils/report.ts';

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
