import { existsSync } from 'node:fs';
import { define } from 'gunshi';
import { text, password, spinner, note, isCancel } from '@clack/prompts';
import { getCalendarAdapter } from '@when/calendar';
import { ConfigEditor } from '@when/config';
import type { CalDavCalendar } from '@when/config';
import type { FetchFn } from '@when/calendar';
import { getValidatedConfigPath } from '../../../utils/config-path.ts';

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

interface CalDavCredentials {
	calendarId: string;
	url: string;
	username: string;
	passwordPlain: string;
}

function validateConfigExists(configPath: string): boolean {
	if (!existsSync(configPath)) {
		console.error(`FAIL  No configuration file found at: ${configPath}`);
		console.error(
			`      Please specify the path to your config.yaml using --config (e.g., "--config apps/web/config.yaml").`
		);
		process.exitCode = 1;
		return false;
	}
	return true;
}

async function promptCalDavCredentials(configPath: string): Promise<CalDavCredentials | null> {
	let existingCalendarIds: string[] = [];
	try {
		const editor = new ConfigEditor(configPath);
		const calendars = (editor.get('calendars') as { id: string }[]) ?? [];
		existingCalendarIds = calendars.map((c) => c.id);
	} catch {
		// Ignore if config parsing fails initially; verification step will catch errors
	}

	const calendarId = await text({
		message: 'Enter a unique ID for this calendar (e.g., "work"):',
		placeholder: 'work',
		validate(value) {
			if (!value || !value.trim()) return 'Calendar ID is required';
			if (existingCalendarIds.includes(value.trim())) {
				return `A calendar with ID "${value.trim()}" already exists in config.yaml.`;
			}
		}
	});
	if (isCancel(calendarId)) return null;

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
	if (isCancel(url)) return null;

	const username = await text({
		message: 'Enter your CalDAV username:',
		validate(value) {
			if (!value || !value.trim()) return 'Username is required';
		}
	});
	if (isCancel(username)) return null;

	const rawPassword = await password({
		message: 'Enter your CalDAV password (or app password):',
		validate(value) {
			if (!value || !value.trim()) return 'Password is required';
		}
	});
	if (isCancel(rawPassword)) return null;

	return {
		calendarId: calendarId.trim(),
		url: url.trim(),
		username: username.trim(),
		passwordPlain: rawPassword
	};
}

async function verifyAndSaveCalDav(configPath: string, creds: CalDavCredentials): Promise<void> {
	const { calendarId, url, username, passwordPlain } = creds;
	const cal: CalDavCalendar = {
		id: calendarId,
		type: 'caldav',
		url,
		username,
		password: passwordPlain
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
		process.exitCode = 1;
	}
}

export const caldavAddCommand = define({
	name: 'caldav',
	description: 'Wizard to add CalDAV calendar integration',
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

		if (!validateConfigExists(configPath)) {
			return;
		}

		const creds = await promptCalDavCredentials(configPath);
		if (!creds) {
			return;
		}

		await verifyAndSaveCalDav(configPath, creds);
	}
});
