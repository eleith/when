import { define } from 'gunshi';
import { testCommand } from './test.ts';

export const emailCommand = define({
	name: 'email',
	description: 'Test email rendering and delivery via the worker',
	subCommands: {
		test: testCommand
	},
	run() {
		console.log('Usage:\n  when-cli email test <address>');
	}
});
