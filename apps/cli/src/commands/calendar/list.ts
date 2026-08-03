import { define } from 'gunshi';
import { allCalendars, type WhenConfiguration } from '@when/config';
import { loadConfigFromCtx } from '../../utils/command.ts';

export function runCalendarList(config: WhenConfiguration): void {
	const calendars = allCalendars(config);
	if (calendars.length === 0) {
		console.log('No calendars configured.');
		return;
	}
	for (const c of calendars) {
		console.log(`${c.name}  (${c.provider.type})`);
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
