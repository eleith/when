import { existsSync } from 'node:fs';
import { define } from 'gunshi';
import { text, password, spinner, note, isCancel } from '@clack/prompts';
import { getCalendarAdapter } from '@when/calendar';
import { ConfigEditor } from '@when/config';
import type { CalDavCalendar } from '@when/config';
import type { FetchFn } from '@when/calendar';
import { getValidatedConfigPath } from '../../../utils/config-path.ts';

interface TemporalInstant {
	add(duration: { hours: number }): TemporalInstant;
}

interface TemporalGlobal {
	Now: {
		instant(): TemporalInstant;
	};
}

const { Temporal } = globalThis as unknown as { Temporal: TemporalGlobal };

export async function verifyCalDavConnection(
	cal: CalDavCalendar,
	fetchImpl?: FetchFn
): Promise<void> {
	const adapter = getCalendarAdapter(cal);
	const now = Temporal.Now.instant();
	const window = { start: now, end: now.add({ hours: 1 }) };
	await adapter.fetchBusy(window as unknown as import('@when/calendar').ExpandWindow, {
		fetchImpl
	});
}

export const caldavSetupCommand = define({
	name: 'caldav',
	description: 'Wizard to setup CalDAV calendar integration',
	args: {
		config: {
			type: 'string',
			short: 'c',
			description: 'Path to config.yaml file'
		}
	},
	async run(ctx) {
		const configPathArg = ctx.values.config;
		const configPath = getValidatedConfigPath(configPathArg);

		if (!existsSync(configPath)) {
			console.error(`FAIL  No configuration file found at: ${configPath}`);
			console.error(
				`      Please specify the path to your config.yaml using --config (e.g., "--config apps/web/config.yaml").`
			);
			process.exitCode = 1;
			return;
		}

		const calendarId = await text({
			message: 'Enter a unique ID for this calendar (e.g., "work"):',
			placeholder: 'work',
			validate(value) {
				if (!value || !value.trim()) return 'Calendar ID is required';
			}
		});
		if (isCancel(calendarId)) return;

		const url = await text({
			message: 'Enter your CalDAV calendar URL:',
			placeholder: 'https://example.com/remote.php/dav/calendars/username/work/',
			validate(value) {
				if (!value || !value.trim()) return 'CalDAV URL is required';
				try {
					new URL(value);
				} catch {
					return 'Must be a valid URL';
				}
			}
		});
		if (isCancel(url)) return;

		const username = await text({
			message: 'Enter your CalDAV username:',
			validate(value) {
				if (!value || !value.trim()) return 'Username is required';
			}
		});
		if (isCancel(username)) return;

		const rawPassword = await password({
			message: 'Enter your CalDAV password (or app password):',
			validate(value) {
				if (!value || !value.trim()) return 'Password is required';
			}
		});
		if (isCancel(rawPassword)) return;

		const cal: CalDavCalendar = {
			id: calendarId,
			type: 'caldav',
			url,
			username,
			password: rawPassword
		};

		const s = spinner();
		s.start('Verifying CalDAV connection...');

		try {
			await verifyCalDavConnection(cal);
			s.message('Writing calendar to configuration...');

			const editor = new ConfigEditor(configPath);
			const calendars = (editor.get('calendars') as { id: string }[]) ?? [];
			const duplicate = calendars.find((c) => c.id === calendarId);
			if (duplicate) {
				throw new Error(`A calendar with ID "${calendarId}" already exists in your configuration.`);
			}

			const envVarName = `WHEN_CALENDAR_CALDAV_${calendarId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
			const calToWrite = {
				...cal,
				password: `\${${envVarName}}`
			};

			editor.set(`calendars.${calendars.length}`, calToWrite);

			s.stop('Setup completed successfully!');

			note(
				`Successfully verified and added calendar "${calendarId}" to config.yaml!\n\n` +
					`⚠️  Please define the following environment variable (e.g. in your .env or Docker config):\n\n` +
					`${envVarName}="[your-password-here]"`,
				'Setup Complete'
			);
		} catch (err) {
			s.stop('Failed!');
			const message = err instanceof Error ? err.message : String(err);
			note(
				`Error details:\n${message}\n\nPlease check your credentials and try again.`,
				'Verification Failed'
			);
		}
	}
});
