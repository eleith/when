import { define } from 'gunshi';
import { testProvider } from '@when/jobs';
import { providersAndName, requireProvider } from './shared.ts';
import { reportWorkerRun } from '../../utils/worker.ts';

export const testCommand = define({
	name: 'test',
	description: 'authenticate a provider through the worker',
	args: {
		name: { type: 'positional', required: false, description: 'the provider to test' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	toKebab: true,
	async run(ctx) {
		const resolved = await providersAndName(ctx.values?.name, ctx.values?.config, 'test');
		if (!resolved) return;

		const provider = requireProvider(resolved.config.providers, resolved.name);
		if (!provider) return;

		await reportWorkerRun(
			resolved.config,
			testProvider,
			{ name: resolved.name },
			`${provider.name} (${provider.type})`,
			() => 'authenticated'
		);
	}
});
