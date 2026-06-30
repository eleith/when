#!/usr/bin/env node

import { cli, define } from 'gunshi';
import { intro, outro } from '@clack/prompts';
import { configCommand } from './commands/config/index.ts';
import { calendarCommand } from './commands/calendar/index.ts';

const rootCommand = define({
	name: 'when-cli',
	description: 'When - Command line helper tool',
	run() {
		console.log('When CLI. Use --help to list commands.');
	}
});

try {
	intro('📅 When CLI Helper');
	await cli(process.argv.slice(2), rootCommand, {
		name: 'when-cli',
		subCommands: {
			config: configCommand,
			calendar: calendarCommand
		}
	});
} catch (err) {
	console.error('Error running CLI:', err);
	process.exit(1);
} finally {
	outro('Execution completed.');
}
