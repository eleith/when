import { define } from 'gunshi';
import { listCommand } from './list.ts';
import { testCommand } from './test.ts';

export const calendarCommand = define({
	name: 'calendar',
	description: 'Inspect and test configured calendars',
	subCommands: {
		list: listCommand,
		test: testCommand
	},
	run() {
		console.log('Usage:\n  when-cli calendar list\n  when-cli calendar test <name>');
	}
});
