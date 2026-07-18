import { define } from 'gunshi';
import type { WhenConfiguration } from '@when/config';
import { loadConfigFromCtx } from '../../utils/command.ts';

export function runCalendarList(config: WhenConfiguration): void {
	if (config.calendars.length === 0) {
		console.log('No calendars configured.');
		return;
	}
	for (const c of config.calendars) {
		console.log(`${c.name}  (${c.type})`);
	}
}

export const listCommand = define({
	name: 'list',
	description: 'list configured calendars',
	args: {
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	async run(ctx) {
		const config = await loadConfigFromCtx(ctx.values?.config);
		if (config) runCalendarList(config);
	}
});
