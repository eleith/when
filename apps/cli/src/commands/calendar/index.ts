import { define } from 'gunshi';
import { addCommand } from './add/index.ts';

export const calendarCommand = define({
	name: 'calendar',
	description: 'Manage calendar integrations',
	subCommands: {
		add: addCommand
	},
	run() {
		console.log('Use "when-cli calendar add"');
	}
});
