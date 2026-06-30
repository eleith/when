import { define } from 'gunshi';
import { validateCommand } from './validate.ts';

export const configCommand = define({
	name: 'config',
	description: 'Manage configuration',
	subCommands: {
		validate: validateCommand
	},
	run() {
		console.log('Use "when-cli config validate <path>"');
	}
});
