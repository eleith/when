import { define } from 'gunshi';
import { addCommand } from './add/index.ts';

export const calendarsCommand = define({
	name: 'calendars',
	description: 'Manage calendars',
	subCommands: {
		add: addCommand
	},
	run() {
		console.log('Use "when-cli calendars <subcommand>"');
	}
});
