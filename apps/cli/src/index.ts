import { cli, define } from 'gunshi';
import { intro, outro } from '@clack/prompts';
import { configCommand } from './commands/config/index.ts';
import { serviceCommand } from './commands/service/index.ts';
import { calendarCommand } from './commands/calendar/index.ts';
import { emailCommand } from './commands/email/index.ts';
import { calendarsCommand } from './commands/calendars/index.ts';
import { schedulesCommand } from './commands/schedules/index.ts';
import { meetingsCommand } from './commands/meetings/index.ts';
import { appearanceCommand } from './commands/appearance/index.ts';

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
			service: serviceCommand,
			calendar: calendarCommand,
			email: emailCommand,
			calendars: calendarsCommand,
			schedules: schedulesCommand,
			meetings: meetingsCommand,
			appearance: appearanceCommand
		}
	});
} catch (err) {
	console.error('Error running CLI:', err);
	process.exit(1);
} finally {
	outro('Execution completed.');
}
