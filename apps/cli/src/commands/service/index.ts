import { define } from 'gunshi';
import { ConfigError, loadConfigFileStructure, type Service } from '@when/config';
import { requireConfigPath } from '../../utils/config-path.ts';
import { fail, detail } from '../../utils/report.ts';
import { runServiceList } from './list.ts';
import { runServiceTest } from './test.ts';

export const serviceCommand = define({
	name: 'service',
	description: 'Inspect and authenticate configured services',
	args: {
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	async run(ctx) {
		const name = ctx.positionals[ctx.commandPath.length];
		const action = ctx.positionals[ctx.commandPath.length + 1];

		if (!name) {
			console.log('Usage:\n  when-cli service list\n  when-cli service <name> test');
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

		await dispatchAction(services, name, action);
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
	action: string | undefined
): Promise<void> {
	if (!action) {
		fail(`specify an action for "${name}": test`);
		return;
	}
	switch (action) {
		case 'test':
			await runServiceTest(services, name);
			break;
		default:
			fail(`unknown action "${action}" — available: test`);
	}
}
