import { define } from 'gunshi';
import { statusCommand } from './status.ts';
import { migrateCommand } from './migrate.ts';

export const dbCommand = define({
	name: 'db',
	description: 'Inspect and migrate the app database',
	subCommands: {
		status: statusCommand,
		migrate: migrateCommand
	},
	run() {
		console.log('Usage:\n  when-cli db status\n  when-cli db migrate');
	}
});
