import { define } from 'gunshi';
import { listCommand } from './list.ts';
import { testCommand } from './test.ts';
import { calendarsCommand } from './calendars.ts';
import { tokenCommand } from './token.ts';

export const serviceCommand = define({
	name: 'service',
	description: 'Inspect and authenticate configured services',
	subCommands: {
		list: listCommand,
		test: testCommand,
		calendars: calendarsCommand,
		token: tokenCommand
	},
	run() {
		console.log(
			'Usage:\n  when-cli service list\n  when-cli service test <name>\n  when-cli service calendars <name>\n  when-cli service token <name>'
		);
	}
});
