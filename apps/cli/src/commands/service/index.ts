import { define } from 'gunshi';
import { ConfigError, loadConfigFileStructure, type Service } from '@when/config';
import { requireConfigPath } from '../../utils/config-path.ts';
import { fail, detail } from '../../utils/report.ts';
import { runServiceList } from './list.ts';
import { runServiceTest } from './test.ts';
import { runServiceToken } from './token.ts';

export const serviceCommand = define({
	name: 'service',
	description: 'Inspect and authenticate configured services',
	args: {
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' },
		quiet: { type: 'boolean', description: 'For the token action, print only the raw token.' }
	},
	async run(ctx) {
		const name = ctx.positionals[ctx.commandPath.length];
		const action = ctx.positionals[ctx.commandPath.length + 1];

		if (!name) {
			console.log('Usage:\n  when-cli service list\n  when-cli service <name> <test | token>');
			return;
		}

		const configPath = requireConfigPath(ctx.values?.config);
		if (!configPath) return;

		const services = await loadServices(configPath);
		if (!services) return;

		if (name === 'list') {
			runServiceList(services);
			return;
		}

		await dispatchAction(services, name, action, ctx.values?.quiet === true);
	}
});

async function loadServices(configPath: string): Promise<Service[] | null> {
	try {
		const config = await loadConfigFileStructure(configPath);
		return config.services ?? [];
	} catch (err) {
		if (err instanceof ConfigError) {
			fail('config is not valid — fix it first (when-cli config validate)');
			for (const issue of err.issues) detail(`${issue.path}: ${issue.message}`);
			return null;
		}
		throw err;
	}
}

async function dispatchAction(
	services: Service[],
	name: string,
	action: string | undefined,
	quiet: boolean
): Promise<void> {
	if (!action) {
		fail(`specify an action for "${name}": test | token`);
		return;
	}
	switch (action) {
		case 'test':
			await runServiceTest(services, name);
			break;
		case 'token':
			await runServiceToken(services, name, quiet);
			break;
		default:
			fail(`unknown action "${action}" — available: test | token`);
	}
}
