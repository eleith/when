import { define } from 'gunshi';
import type { Service } from '@when/config';
import { loadConfigFromCtx } from '../../utils/command.ts';

export function runServiceList(services: Service[]): void {
	if (services.length === 0) {
		console.log('No services configured.');
		return;
	}
	for (const s of services) {
		console.log(`${s.name}  (${s.type})`);
	}
}

export const listCommand = define({
	name: 'list',
	description: 'list configured services',
	args: {
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	async run(ctx) {
		const config = await loadConfigFromCtx(ctx.values?.config);
		if (config) runServiceList(config.providers ?? []);
	}
});
