import { define } from 'gunshi';
import { validateCommand } from './validate.ts';
import { initCommand } from './init.ts';

export const configCommand = define({
	name: 'config',
	description: 'Manage configuration',
	subCommands: {
		init: initCommand,
		validate: validateCommand
	},
	run() {
		console.log('Use "when-cli config <init|validate>"');
	}
});
