import { define } from 'gunshi';
import { googleAddCommand } from './google.ts';
import { caldavAddCommand } from './caldav.ts';
import { nextcloudAddCommand } from './nextcloud.ts';

export const addCommand = define({
	name: 'add',
	description: 'Add calendar integrations',
	subCommands: {
		google: googleAddCommand,
		caldav: caldavAddCommand,
		nextcloud: nextcloudAddCommand
	},
	run() {
		console.log('Use "when-cli calendars add <google|caldav|nextcloud>"');
	}
});
