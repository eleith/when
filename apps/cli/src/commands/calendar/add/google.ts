import { define } from 'gunshi';
import { text, spinner, note, isCancel, select } from '@clack/prompts';
import { getCalendarAdapter, type ExpandWindow } from '@when/calendar';
import { ConfigEditor } from '@when/config';
import type { GoogleCalendar, Service } from '@when/config';
import { getValidatedConfigPath, validateConfigExists } from '../../../utils/config-path.ts';
import { getOrCreateGoogleService, type GoogleTokens } from '../../../services/google.ts';
import { getExistingIds } from '../../../utils/config.ts';

export async function verifyGoogleConnection(
	cal: GoogleCalendar,
	service: Service
): Promise<void> {
	const adapter = getCalendarAdapter(cal, [service]);
	const now = Temporal.Now.instant();
	const window: ExpandWindow = { start: now, end: now.add({ hours: 1 }) };
	await adapter.fetchBusy(window);
}

export interface GoogleCalendarItem {
	id: string;
	summary: string;
	primary?: boolean;
}

export async function fetchCalendarList(
	accessToken: string
): Promise<GoogleCalendarItem[]> {
	const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
		headers: {
			Authorization: `Bearer ${accessToken}`
		}
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Failed to fetch calendar list: ${response.status} ${text}`);
	}

	const data = (await response.json()) as { items?: GoogleCalendarItem[] };
	return data.items || [];
}

async function promptGoogleCalendarId(existingIds: string[]): Promise<string | null> {
	const calendarId = await text({
		message: 'Enter a unique ID for this calendar (e.g., "personal"):',
		placeholder: 'personal',
		validate(value) {
			if (!value || !value.trim()) return 'Calendar ID is required';
			if (existingIds.includes(value.trim())) {
				return `A calendar with ID "${value.trim()}" already exists in config.yaml.`;
			}
		}
	});
	if (isCancel(calendarId)) return null;
	return calendarId.trim();
}

async function promptCalendarSelection(calendars: GoogleCalendarItem[]): Promise<string | null> {
	if (calendars.length === 0) {
		note('No calendars found in your Google account.', 'No Calendars Found');
		process.exitCode = 1;
		return null;
	}

	const selectedCalendarId = await select({
		message: 'Select the Google Calendar you want to use:',
		options: calendars.map((cal) => ({
			value: cal.id,
			label: `${cal.summary}${cal.primary ? ' (Primary)' : ''}`
		}))
	});
	if (isCancel(selectedCalendarId)) return null;

	return selectedCalendarId as string;
}

async function verifyGoogleRefreshToken(
	clientId: string,
	clientSecret: string,
	refreshToken: string
): Promise<string> {
	const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: 'refresh_token'
		})
	});

	if (!tokenResponse.ok) {
		const text = await tokenResponse.text();
		throw new Error(`Failed to authenticate with Google: ${text}`);
	}

	const data = (await tokenResponse.json()) as { access_token: string };
	return data.access_token;
}

interface WriteGoogleCalendarConfigOpts {
	configPath: string;
	cal: GoogleCalendar;
	serviceId: string;
	clientId: string;
	envClientSecret: string;
	envRefreshToken: string;
	isNew: boolean;
}

function writeGoogleCalendarConfig({
	configPath,
	cal,
	serviceId,
	clientId,
	envClientSecret,
	envRefreshToken,
	isNew
}: WriteGoogleCalendarConfigOpts): void {
	const editor = new ConfigEditor(configPath);
	const servicesList = (editor.get('services') as Service[]) ?? [];
	const calendarsList = (editor.get('calendars') as GoogleCalendar[]) ?? [];

	if (isNew) {
		const serviceToWrite = {
			id: serviceId,
			type: 'google',
			client_id: clientId,
			client_secret: `\${${envClientSecret}}`,
			refresh_token: `\${${envRefreshToken}}`
		};
		editor.set(`services.${servicesList.length}`, serviceToWrite);
	}

	editor.set(`calendars.${calendarsList.length}`, cal);
}

function getCompletionMessage(
	id: string,
	serviceId: string,
	clientSecret: string,
	refreshToken: string,
	envClientSecret: string,
	envRefreshToken: string,
	isNew: boolean
): string {
	let message = `Successfully verified and added calendar "${id}" to config.yaml!\n`;
	if (isNew) {
		message +=
			`\n⚠️  Please define the following environment variables (e.g. in your .env or Docker config):\n\n` +
			`${envClientSecret}="${clientSecret}"\n` +
			`${envRefreshToken}="${refreshToken}"`;
	} else {
		message += `\nReused existing service configuration "${serviceId}".`;
	}
	return message;
}

export const googleAddCommand = define({
	name: 'google',
	description: 'Wizard to add Google Calendar integration',
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

		const existingCalendarIds = getExistingIds(configPath, 'calendars');
		const id = await promptGoogleCalendarId(existingCalendarIds);
		if (!id) return;

		const serviceResult = await getOrCreateGoogleService(configPath, id);
		if (!serviceResult) return;

		const {
			serviceId,
			clientId,
			clientSecret,
			refreshToken,
			isNew,
			envClientSecret,
			envRefreshToken
		} = serviceResult;

		let accessToken: string;
		try {
			accessToken = await verifyGoogleRefreshToken(clientId, clientSecret, refreshToken);
		} catch (err) {
			const text = err instanceof Error ? err.message : String(err);
			note(text, 'Verification Failed');
			process.exitCode = 1;
			return;
		}

		const calendars = await fetchCalendarList(accessToken);
		const selectedCalendarId = await promptCalendarSelection(calendars);
		if (!selectedCalendarId) {
			return;
		}

		const cal: GoogleCalendar = {
			id,
			type: 'google',
			service_id: serviceId,
			google_calendar_id: selectedCalendarId
		};

		const service: Service = {
			id: serviceId,
			type: 'google',
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken
		};

		const s = spinner();
		s.start('Verifying calendar connection...');

		try {
			await verifyGoogleConnection(cal, service);
			s.message('Writing calendar and service to configuration...');

			writeGoogleCalendarConfig({
				configPath,
				cal,
				serviceId,
				clientId,
				envClientSecret,
				envRefreshToken,
				isNew
			});

			s.stop('Setup completed successfully!');

			const completionMsg = getCompletionMessage(
				id,
				serviceId,
				clientSecret,
				refreshToken,
				envClientSecret,
				envRefreshToken,
				isNew
			);
			note(completionMsg, 'Setup Complete');
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
});
