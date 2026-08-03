import { define } from 'gunshi';
import { testCalendar } from '@when/jobs';
import { findCalendar } from '@when/config';
import { loadConfigFromCtx } from '../../utils/command.ts';
import { reportWorkerRun } from '../../utils/worker.ts';
import { fail } from '../../utils/report.ts';

export const testCommand = define({
	name: 'test',
	description: 'fetch busy intervals through the worker to confirm a calendar is reachable',
	args: {
		name: { type: 'positional', required: false, description: 'the calendar to test' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	toKebab: true,
	async run(ctx) {
		const name = ctx.values?.name as string | undefined;
		if (!name) {
			fail('calendar test requires a calendar name');
			return;
		}
		const config = await loadConfigFromCtx(ctx.values?.config);
		if (!config) return;

		const cal = findCalendar(config, name);
		if (!cal) {
			fail(`no calendar named "${name}"`);
			return;
		}

		await reportWorkerRun(
			config,
			testCalendar,
			{ name },
			`${name} (${cal.type})`,
			({ busyCount, days }) => `${busyCount} busy interval(s) over the next ${days} days`
		);
	}
});
