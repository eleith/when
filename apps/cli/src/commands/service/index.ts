import { define } from 'gunshi';
import { listCommand } from './list.ts';
import { testCommand } from './test.ts';
import { calendarsCommand } from './calendars.ts';

export const serviceCommand = define({
	name: 'service',
	description: 'Inspect configured services',
	subCommands: {
		list: listCommand,
		test: testCommand,
		calendars: calendarsCommand
	},
	run() {
		console.log(
			'Usage:\n  when-cli service list\n  when-cli service test <name>\n  when-cli service calendars <name>'
		);
	}
});
