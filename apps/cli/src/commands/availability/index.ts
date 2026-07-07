import { define } from 'gunshi';
import { availabilityAddCommand } from './add.ts';

export const availabilityCommand = define({
	name: 'availability',
	description: 'Manage availability profiles',
	subCommands: {
		add: availabilityAddCommand
	},
	run() {
		console.log('Use "when-cli availability add"');
	}
});
