import { define } from 'gunshi';
import { schedulesAddCommand } from './add.ts';

export const schedulesCommand = define({
	name: 'schedules',
	description: 'Manage schedules',
	subCommands: {
		add: schedulesAddCommand
	},
	run() {
		console.log('Use "when-cli schedules add"');
	}
});
