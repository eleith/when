import { define } from 'gunshi';
import { googleSetupCommand } from './google.ts';
import { caldavSetupCommand } from './caldav.ts';

export const setupCommand = define({
	name: 'setup',
	description: 'Setup calendar integrations',
	subCommands: {
		google: googleSetupCommand,
		caldav: caldavSetupCommand
	},
	run() {
		console.log('Use "when-cli calendar setup google" or "when-cli calendar setup caldav"');
	}
});
