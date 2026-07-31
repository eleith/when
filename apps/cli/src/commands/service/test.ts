import { define } from 'gunshi';
import { connectService, getServiceAdapter } from '@when/calendar';
import type { Service } from '@when/config';
import { requireService, resolveServiceEnv, servicesAndName } from './shared.ts';
import { pass, fail } from '../../utils/report.ts';

export const testCommand = define({
	name: 'test',
	description: 'authenticate a service (Google token refresh / CalDAV PROPFIND)',
	args: {
		name: { type: 'positional', required: false, description: 'the service to test' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' },
		refreshToken: {
			type: 'string',
			description: 'refresh token for a google service (the stored one lives in the database)'
		}
	},
	toKebab: true,
	async run(ctx) {
		const resolved = await servicesAndName(ctx.values?.name, ctx.values?.config, 'test');
		if (resolved) await runServiceTest(resolved.services, resolved.name, ctx.values?.refreshToken);
	}
});

export async function runServiceTest(
	services: Service[],
	name: string,
	refreshToken?: string
): Promise<void> {
	const service = requireService(services, name);
	if (!service) return;

	const resolved = resolveServiceEnv(service);
	if (!resolved) return;

	const adapter = getServiceAdapter(connectService(resolved, refreshToken ?? null));
	if (adapter.usesOAuth && !refreshToken) {
		fail(`${name} (${resolved.type}) — pass --refresh-token; the stored one lives in the database`);
		return;
	}

	try {
		await adapter.verify();
		pass(`${name} (${resolved.type}) — authenticated`);
	} catch (err) {
		fail(`${name} (${resolved.type}) — ${err instanceof Error ? err.message : String(err)}`);
	}
}
