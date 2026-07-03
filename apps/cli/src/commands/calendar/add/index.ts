import { define } from 'gunshi';
import { googleAddCommand } from './google.ts';
import { caldavAddCommand } from './caldav.ts';

export const addCommand = define({
	name: 'add',
	description: 'Add calendar integrations',
	subCommands: {
		google: googleAddCommand,
		caldav: caldavAddCommand
	},
	run() {
		console.log('Use "when-cli calendar add google" or "when-cli calendar add caldav"');
	}
});
