import { define } from 'gunshi';
import type { Service } from '@when/config';
import { requireConfigPath } from '../../utils/config-path.ts';
import { loadConfigStructural } from '../../utils/load.ts';
import { fail } from '../../utils/report.ts';
import { runServiceList } from './list.ts';
import { runServiceTest } from './test.ts';
import { runServiceCalendars } from './calendars.ts';
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
			console.log(
				'Usage:\n  when-cli service list\n  when-cli service <name> <test | calendars | token>'
			);
			return;
		}

		const configPath = requireConfigPath(ctx.values?.config);
		if (!configPath) return;

		const config = await loadConfigStructural(configPath);
		if (!config) return;
		const services = config.services ?? [];

		if (name === 'list') {
			runServiceList(services);
			return;
		}

		await dispatchAction(services, name, action, ctx.values?.quiet === true);
	}
});

async function dispatchAction(
	services: Service[],
	name: string,
	action: string | undefined,
	quiet: boolean
): Promise<void> {
	if (!action) {
		fail(`specify an action for "${name}": test | calendars | token`);
		return;
	}
	switch (action) {
		case 'test':
			await runServiceTest(services, name);
			break;
		case 'calendars':
			await runServiceCalendars(services, name);
			break;
		case 'token':
			await runServiceToken(services, name, quiet);
			break;
		default:
			fail(`unknown action "${action}" — available: test | calendars | token`);
	}
}
