import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

const SCOPES = [
	'https://www.googleapis.com/auth/calendar.events',
	'https://www.googleapis.com/auth/calendar.readonly'
].join(' ');

async function openBrowser(url: string) {
	console.log(`\nOpening browser to authenticate...`);
	console.log(`If the browser doesn't open automatically, please click this link:\n\n${url}\n`);

	const platform = process.platform;
	let command: string;
	let args: string[];

	if (platform === 'win32') {
		command = 'cmd';
		args = ['/c', 'start', url];
	} else if (platform === 'darwin') {
		command = 'open';
		args = [url];
	} else {
		command = 'xdg-open';
		args = [url];
	}

	try {
		spawn(command, args, { stdio: 'ignore', detached: true }).unref();
	} catch {
		// Ignore spawn errors
	}
}

async function promptForInput(prompt: string): Promise<string> {
	while (true) {
		const answer = await rl.question(prompt);
		if (answer.trim()) return answer.trim();
	}
}

async function main() {
	console.log('\n📅 When - Google Calendar Setup');
	console.log('---------------------------------');
	console.log('This wizard will help you generate the configuration block for a Google Calendar.');
	console.log('You will need an OAuth 2.0 Client ID and Secret from the Google Cloud Console.');
	console.log('Make sure the Application Type is set to "Desktop app".\n');

	const clientId = await promptForInput('Enter your Google Client ID: ');
	const clientSecret = await promptForInput('Enter your Google Client Secret: ');

	let resolveCode: (code: string) => void;
	const codePromise = new Promise<string>((resolve) => {
		resolveCode = resolve;
	});

	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		if (url.pathname === '/callback') {
			const code = url.searchParams.get('code');
			if (code) {
				resolveCode(code);
				res.writeHead(200, { 'Content-Type': 'text/html' });
				res.end('Authentication successful! You can close this window and return to the terminal.');
				return;
			}
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('Error: No code found in the callback URL.');
			return;
		}
		res.writeHead(404, { 'Content-Type': 'text/plain' });
		res.end('Not found');
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));

	const port = (server.address() as AddressInfo).port;
	const redirectUri = `http://localhost:${port}/callback`;

	const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
	authUrl.searchParams.set('client_id', clientId);
	authUrl.searchParams.set('redirect_uri', redirectUri);
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('scope', SCOPES);
	authUrl.searchParams.set('access_type', 'offline');
	authUrl.searchParams.set('prompt', 'consent');

	await openBrowser(authUrl.toString());

	console.log('Waiting for authorization...');
	const code = await codePromise;
	server.close();

	console.log('\nExchanging authorization code for tokens...');

	const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
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

	if (!tokenResponse.ok) {
		console.error('\n❌ Failed to obtain tokens from Google.');
		console.error(await tokenResponse.text());
		process.exit(1);
	}

	const tokenData = await tokenResponse.json();
	const accessToken = tokenData.access_token;
	const refreshToken = tokenData.refresh_token;

	if (!refreshToken) {
		console.error('\n❌ Google did not return a refresh token.');
		console.error(
			'This usually happens if you have already authorized the app previously without the "prompt=consent" parameter.'
		);
		process.exit(1);
	}

	console.log('Fetching your calendars...\n');

	const calendarsResponse = await fetch(
		'https://www.googleapis.com/calendar/v3/users/me/calendarList',
		{
			headers: {
				Authorization: `Bearer ${accessToken}`
			}
		}
	);

	if (!calendarsResponse.ok) {
		console.error('\n❌ Failed to fetch calendar list.');
		const errorText = await calendarsResponse.text();
		console.error(`Error details: ${errorText}\n`);
		console.error('Common fixes:');
		console.error('1. Did you enable the "Google Calendar API" in the Google Cloud Console?');
		console.error('   (Go to APIs & Services > Library > search "Google Calendar API" > Enable)');
		process.exit(1);
	}

	const calendarsData = await calendarsResponse.json();
	const calendars = calendarsData.items || [];

	if (calendars.length === 0) {
		console.log('No calendars found in your Google account.');
		process.exit(1);
	}

	calendars.forEach((cal: Record<string, unknown>, index: number) => {
		const primary = cal.primary ? ' (Primary)' : '';
		console.log(`[${index + 1}] ${cal.summary}${primary} - ${cal.id}`);
	});

	let selectedIndex = -1;
	while (selectedIndex < 0 || selectedIndex >= calendars.length) {
		const answer = await promptForInput(
			`\nSelect the calendar you want to use (1-${calendars.length}): `
		);
		const num = parseInt(answer, 10);
		if (!isNaN(num) && num >= 1 && num <= calendars.length) {
			selectedIndex = num - 1;
		} else {
			console.log('Invalid selection.');
		}
	}

	const selectedCalendar = calendars[selectedIndex];

	console.log(
		'\n✅ Setup Complete! Add the following block to your config.yaml under "calendars":\n'
	);
	console.log('--------------------------------------------------');
	console.log(`  - id: "my-google-cal"`);
	console.log(`    type: "google"`);
	console.log(`    google_calendar_id: "${selectedCalendar.id}"`);
	console.log(`    client_id: "${clientId}"`);
	console.log(`    client_secret: "${clientSecret}"`);
	console.log(`    refresh_token: "${refreshToken}"`);
	console.log('--------------------------------------------------\n');
	console.log('⚠️  Store your client_id, client_secret, and refresh_token securely.');
	console.log(
		'   You can use ${ENV_VAR} syntax in config.yaml to load them from the environment.\n'
	);

	process.exit(0);
}

main().catch((err) => {
	console.error('\n❌ An unexpected error occurred:', err);
	process.exit(1);
});
