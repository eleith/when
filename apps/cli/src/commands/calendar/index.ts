import { define } from 'gunshi';
import { requireConfigPath } from '../../utils/config-path.ts';
import { loadConfigStructural } from '../../utils/load.ts';
import { fail } from '../../utils/report.ts';
import { runCalendarList } from './list.ts';
import { runCalendarTest } from './test.ts';

export const calendarCommand = define({
	name: 'calendar',
	description: 'Inspect and test configured calendars',
	args: {
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	async run(ctx) {
		const name = ctx.positionals[ctx.commandPath.length];
		const action = ctx.positionals[ctx.commandPath.length + 1];

		if (!name) {
			console.log('Usage:\n  when-cli calendar list\n  when-cli calendar <name> test');
			return;
		}

		const configPath = requireConfigPath(ctx.values?.config);
		if (!configPath) return;

		const config = await loadConfigStructural(configPath);
		if (!config) return;

		if (name === 'list') {
			runCalendarList(config);
			return;
		}

		if (action !== 'test') {
			fail(
				action
					? `unknown action "${action}" — available: test`
					: `specify an action for "${name}": test`
			);
			return;
		}
		await runCalendarTest(config, name);
	}
});
