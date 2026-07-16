import { define } from 'gunshi';
import { meetingsAddCommand } from './add.ts';

export const meetingsCommand = define({
	name: 'meetings',
	description: 'Manage meetings',
	subCommands: {
		add: meetingsAddCommand
	},
	run() {
		console.log('Use "when-cli meetings add"');
	}
});
