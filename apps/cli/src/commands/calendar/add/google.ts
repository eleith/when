import { existsSync } from 'node:fs';
import { define } from 'gunshi';
import { text, password, spinner, note, isCancel, select } from '@clack/prompts';
import { getCalendarAdapter } from '@when/calendar';
import { ConfigEditor } from '@when/config';
import type { GoogleCalendar } from '@when/config';
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

export async function verifyGoogleConnection(
	cal: GoogleCalendar,
	fetchImpl?: FetchFn
): Promise<void> {
	const adapter = getCalendarAdapter(cal);
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

const SCOPES = [
	'https://www.googleapis.com/auth/calendar.events',
	'https://www.googleapis.com/auth/calendar.readonly'
].join(' ');

interface GoogleAppCredentials {
	calendarId: string;
	clientId: string;
	clientSecret: string;
}

interface GoogleConfigDetails extends GoogleAppCredentials {
	refreshToken: string;
	selectedCalendarId: string;
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

async function promptGoogleAppCredentials(configPath: string): Promise<GoogleAppCredentials | null> {
	let existingCalendarIds: string[] = [];
	try {
		const editor = new ConfigEditor(configPath);
		const calendars = (editor.get('calendars') as { id: string }[]) ?? [];
		existingCalendarIds = calendars.map((c) => c.id);
	} catch (err) {
		console.error(
			`FAIL  Failed to read configuration file: ${err instanceof Error ? err.message : String(err)}`
		);
		process.exitCode = 1;
		return null;
	}

	const calendarId = await text({
		message: 'Enter a unique ID for this calendar (e.g., "personal"):',
		placeholder: 'personal',
		validate(value) {
			if (!value || !value.trim()) return 'Calendar ID is required';
			const duplicate = existingCalendarIds.find((c) => c.id === value.trim());
			if (duplicate) return `A calendar with ID "${value.trim()}" already exists in config.yaml.`;
		}
	});
	if (isCancel(calendarId)) return null;

	const clientId = await text({
		message: 'Enter your Google Client ID:',
		validate(value) {
			if (!value || !value.trim()) return 'Client ID is required';
		}
	});
	if (isCancel(clientId)) return null;

	const clientSecret = await password({
		message: 'Enter your Google Client Secret:',
		validate(value) {
			if (!value || !value.trim()) return 'Client Secret is required';
		}
	});
	if (isCancel(clientSecret)) return null;

	return {
		calendarId: calendarId.trim(),
		clientId: clientId.trim(),
		clientSecret: clientSecret.trim()
	};
}

async function runGoogleOAuthFlow(
	appCreds: GoogleAppCredentials
): Promise<{ refreshToken: string; calendars: GoogleCalendarItem[] } | null> {
	const { clientId, clientSecret } = appCreds;
	const redirectUri = 'http://localhost';
	const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
	authUrl.searchParams.set('client_id', clientId);
	authUrl.searchParams.set('redirect_uri', redirectUri);
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('scope', SCOPES);
	authUrl.searchParams.set('access_type', 'offline');
	authUrl.searchParams.set('prompt', 'consent');

	const linkText = `\u001b]8;;${authUrl.toString()}\u001b\\[Click here to open Google Authorization]\u001b]8;;\u001b\\`;

	console.log(
		`\n1. Open this link in your browser to authorize Google Calendar:\n\n   ${linkText}\n`
	);
	console.log(
		`   If the link isn't clickable, copy and paste this URL:\n   ${authUrl.toString()}\n`
	);

	const rawInput = await text({
		message: 'Enter the authorization code (or paste the redirect URL):',
		validate(value) {
			if (!value || !value.trim()) return 'Authorization code or URL is required';
		}
	});
	if (isCancel(rawInput)) return null;

	let code = rawInput.trim();
	if (
		code.startsWith('http://') ||
		code.startsWith('https://') ||
		code.includes('?code=') ||
		code.includes('&code=')
	) {
		try {
			const parsedUrl = new URL(code);
			const codeParam = parsedUrl.searchParams.get('code');
			if (codeParam) {
				code = codeParam;
			}
		} catch {
			// Fallback to raw input
		}
	}

	const s = spinner();
	s.start('Exchanging authorization code for tokens...');

	try {
		const tokens = await exchangeCodeForTokens(clientId, clientSecret, code, redirectUri);
		const accessToken = tokens.access_token;
		const refreshToken = tokens.refresh_token;

		if (!refreshToken) {
			throw new Error(
				'Google did not return a refresh token.\n\n' +
					'This usually happens if you have already authorized this app before.\n' +
					'Please revoke access to the app in your Google Account settings, or add "prompt=consent" manually, and try again.'
			);
		}

		s.message('Fetching your Google Calendars...');
		const calendars = await fetchCalendarList(accessToken);
		s.stop('Google account authenticated successfully!');

		return { refreshToken, calendars };
	} catch (err) {
		s.stop('Failed!');
		const message = err instanceof Error ? err.message : String(err);
		note(
			`Error details:\n${message}\n\nPlease check your credentials and try again.`,
			'Authentication Failed'
		);
		process.exitCode = 1;
		return null;
	}
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

async function verifyAndSaveGoogle(
	configPath: string,
	details: GoogleConfigDetails
): Promise<void> {
	const { calendarId, clientId, clientSecret, refreshToken, selectedCalendarId } = details;
	const cal: GoogleCalendar = {
		id: calendarId,
		type: 'google',
		client_id: clientId,
		client_secret: clientSecret,
		refresh_token: refreshToken,
		google_calendar_id: selectedCalendarId
	};

	const s = spinner();
	s.start('Verifying calendar connection...');

	try {
		await verifyGoogleConnection(cal);
		s.message('Writing calendar to configuration...');

		const editor = new ConfigEditor(configPath);
		const calendarsList = (editor.get('calendars') as { id: string }[]) ?? [];
		const duplicate = calendarsList.find((c) => c.id === calendarId);
		if (duplicate) {
			throw new Error(`A calendar with ID "${calendarId}" already exists in your configuration.`);
		}

		const envId = calendarId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
		const envRefreshToken = `WHEN_CALENDAR_GOOGLE_${envId}_REFRESH_TOKEN`;

		const calToWrite = {
			...cal,
			refresh_token: `\${${envRefreshToken}}`
		};

		editor.set(`calendars.${calendarsList.length}`, calToWrite);
		s.stop('Setup completed successfully!');

		note(
			`Successfully verified and added calendar "${calendarId}" to config.yaml!\n\n` +
				`⚠️  Please define the following environment variable (e.g. in your .env or Docker config):\n\n` +
				`${envRefreshToken}="${refreshToken}"`,
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

		const appCreds = await promptGoogleAppCredentials(configPath);
		if (!appCreds) {
			return;
		}

		const oauthResult = await runGoogleOAuthFlow(appCreds);
		if (!oauthResult) {
			return;
		}

		const selectedCalendarId = await promptCalendarSelection(oauthResult.calendars);
		if (!selectedCalendarId) {
			return;
		}

		await verifyAndSaveGoogle(configPath, {
			...appCreds,
			refreshToken: oauthResult.refreshToken,
			selectedCalendarId
		});
	}
});
