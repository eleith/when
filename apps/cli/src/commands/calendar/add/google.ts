import { existsSync } from 'node:fs';
import { define } from 'gunshi';
import { text, spinner, note, isCancel, select } from '@clack/prompts';
import { getCalendarAdapter } from '@when/calendar';
import { ConfigEditor } from '@when/config';
import type { GoogleCalendar, WhenConfiguration } from '@when/config';
import type { FetchFn } from '@when/calendar';
import { getValidatedConfigPath } from '../../../utils/config-path.ts';
import { getOrCreateGoogleService } from '../../../services/google.ts';

export async function verifyGoogleConnection(
	cal: GoogleCalendar,
	config: WhenConfiguration,
	fetchImpl?: FetchFn
): Promise<void> {
	const adapter = getCalendarAdapter(cal, config);
	const now = Temporal.Now.instant();
	const window = { start: now, end: now.add({ hours: 1 }) };
	await adapter.fetchBusy(window as unknown as import('@when/calendar').ExpandWindow, {
		fetchImpl
	});
}

export interface GoogleTokens {
	access_token: string;
	refresh_token: string;
	expires_in: number;
}

export async function exchangeCodeForTokens(
	clientId: string,
	clientSecret: string,
	code: string,
	redirectUri: string,
	fetchImpl: FetchFn = fetch
): Promise<GoogleTokens> {
	const response = await fetchImpl('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri
		})
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Failed to exchange authorization code: ${response.status} ${text}`);
	}

	return (await response.json()) as GoogleTokens;
}

export interface GoogleCalendarItem {
	id: string;
	summary: string;
	primary?: boolean;
}

export async function fetchCalendarList(
	accessToken: string,
	fetchImpl: FetchFn = fetch
): Promise<GoogleCalendarItem[]> {
	const response = await fetchImpl('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
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

		let existingCalendarIds: string[] = [];
		try {
			const editor = new ConfigEditor(configPath);
			const calendars = (editor.get('calendars') as { id: string }[]) ?? [];
			existingCalendarIds = calendars.map((c) => c.id);
		} catch {
			// ignore
		}

		const calendarId = await text({
			message: 'Enter a unique ID for this calendar (e.g., "personal"):',
			placeholder: 'personal',
			validate(value) {
				if (!value || !value.trim()) return 'Calendar ID is required';
				if (existingCalendarIds.includes(value.trim()))
					return `A calendar with ID "${value.trim()}" already exists in config.yaml.`;
			}
		});
		if (isCancel(calendarId)) return;
		const id = calendarId.trim();

		const serviceResult = await getOrCreateGoogleService(configPath, id);
		if (!serviceResult) return;

		const { serviceId, clientId, clientSecret, refreshToken, isNew, envClientSecret, envRefreshToken } = serviceResult;

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
			note(`Failed to authenticate with Google: ${text}`, 'Verification Failed');
			process.exitCode = 1;
			return;
		}

		const { access_token } = (await tokenResponse.json()) as { access_token: string };
		const calendars = await fetchCalendarList(access_token);
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

		const tempConfig = {
			services: [
				{
					id: serviceId,
					type: 'google',
					client_id: clientId,
					client_secret: clientSecret,
					refresh_token: refreshToken
				}
			],
			calendars: [cal]
		} as unknown as WhenConfiguration;

		const s = spinner();
		s.start('Verifying calendar connection...');

		try {
			await verifyGoogleConnection(cal, tempConfig);
			s.message('Writing calendar and service to configuration...');

			const editor = new ConfigEditor(configPath);
			const servicesList = (editor.get('services') as any[]) ?? [];
			const calendarsList = (editor.get('calendars') as any[]) ?? [];

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
			s.stop('Setup completed successfully!');

			let completionMsg = `Successfully verified and added calendar "${id}" to config.yaml!\n`;
			if (isNew) {
				completionMsg += `\n⚠️  Please define the following environment variables (e.g. in your .env or Docker config):\n\n` +
					`${envClientSecret}="${clientSecret}"\n` +
					`${envRefreshToken}="${refreshToken}"`;
			} else {
				completionMsg += `\nReused existing service configuration "${serviceId}".`;
			}

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
