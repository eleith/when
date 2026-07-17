import { define } from 'gunshi';
import { requireConfigPath } from '../../utils/config-path.ts';
import { fail } from '../../utils/report.ts';
import { runEmailTest } from './test.ts';

export const emailCommand = define({
	name: 'email',
	description: 'Test email rendering and delivery via the worker',
	args: {
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	async run(ctx) {
		const action = ctx.positionals[ctx.commandPath.length];
		const address = ctx.positionals[ctx.commandPath.length + 1];

		if (action !== 'test') {
			console.log('Usage:\n  when-cli email test <address>');
			return;
		}
		if (!address) {
			fail('email test requires a recipient address');
			return;
		}

		const configPath = requireConfigPath(ctx.values?.config);
		if (!configPath) return;

		await runEmailTest(configPath, address);
	}
});
