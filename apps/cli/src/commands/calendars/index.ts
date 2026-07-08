import { define } from 'gunshi';
import { caldavAddCommand, googleAddCommand } from './add/index.ts';

export const calendarsCommand = define({
	name: 'calendars',
	description: 'Manage calendars',
	subCommands: {
		caldav: caldavAddCommand,
		google: googleAddCommand
	},
	run() {
		console.log('Use "when-cli calendars <subcommand>"');
	}
});
