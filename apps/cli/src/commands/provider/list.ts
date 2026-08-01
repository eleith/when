import { define } from 'gunshi';
import type { Provider } from '@when/config';
import { loadConfigFromCtx } from '../../utils/command.ts';

export function runProviderList(providers: Provider[]): void {
	if (providers.length === 0) {
		console.log('No providers configured.');
		return;
	}
	for (const s of providers) {
		console.log(`${s.name}  (${s.type})`);
	}
}

export const listCommand = define({
	name: 'list',
	description: 'list configured providers',
	args: {
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	async run(ctx) {
		const config = await loadConfigFromCtx(ctx.values?.config);
		if (config) runProviderList(config.providers ?? []);
	}
});
