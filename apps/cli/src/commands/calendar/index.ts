import { define } from 'gunshi';
import { setupCommand } from './setup/index.ts';

export const calendarCommand = define({
	name: 'calendar',
	description: 'Manage calendar integrations',
	subCommands: {
		setup: setupCommand
	},
	run() {
		console.log('Use "when-cli calendar setup"');
	}
});
