import { define } from 'gunshi';
import { listCommand } from './list.ts';
import { testCommand } from './test.ts';
import { calendarsCommand } from './calendars.ts';

export const providerCommand = define({
	name: 'provider',
	description: 'Inspect configured providers',
	subCommands: {
		list: listCommand,
		test: testCommand,
		calendars: calendarsCommand
	},
	run() {
		console.log(
			'Usage:\n  when-cli provider list\n  when-cli provider test <name>\n  when-cli provider calendars <name>'
		);
	}
});
