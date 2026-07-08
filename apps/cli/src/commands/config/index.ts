import { define } from 'gunshi';
import { validateCommand } from './validate.ts';
import { appearanceCommand } from './appearance.ts';

export const configCommand = define({
	name: 'config',
	description: 'Manage configuration',
	subCommands: {
		validate: validateCommand,
		appearance: appearanceCommand
	},
	run() {
		console.log('Use "when-cli config validate <path>" or "when-cli config appearance"');
	}
});
