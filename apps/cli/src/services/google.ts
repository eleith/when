import { text, select, password, spinner, note, isCancel } from '@clack/prompts';
import { buildGoogleAuthUrl, exchangeGoogleAuthCode } from '@when/calendar';
import { ConfigEditor } from '@when/config';
import type { Service } from '@when/config';

export function extractAuthCode(input: string): string {
	if (input.startsWith('http://') || input.startsWith('https://') || input.includes('code=')) {
		try {
			const code = new URL(input).searchParams.get('code');
			if (code) return code;
		} catch {
			// input isn't a URL; fall through and treat it as the raw code
		}
	}
	return input;
}

export async function getOrCreateGoogleService(
	configPath: string,
	baseId: string
): Promise<{
	serviceId: string;
	clientId: string;
	clientSecret: string;
	refreshToken: string;
	isNew: boolean;
	envClientSecret: string;
	envRefreshToken: string;
} | null> {
	let services: Service[] = [];
	try {
		const editor = new ConfigEditor(configPath);
		services = (editor.get('services') as Service[]) ?? [];
	} catch {
		// ignore
	}

	const googleServices = services.filter((s) => s.type === 'google');
	let serviceId = '';
	let isNew = false;
	let clientId = '';
	let clientSecret = '';
	let refreshToken = '';
	let envClientSecret = '';
	let envRefreshToken = '';

	if (googleServices.length > 0) {
		const choice = await select({
			message: 'Select a Google service or create a new one:',
			options: [
				...googleServices.map((s) => ({ value: s.name, label: s.name })),
				{ value: 'new', label: 'Create new Google service configuration' }
			]
		});
		if (isCancel(choice)) return null;

		if (choice !== 'new') {
			serviceId = choice as string;
			const existing = googleServices.find((s) => s.name === serviceId)!;
			clientId = existing.client_id;
			const rawSec = existing.client_secret || '';
			const matchSec = rawSec.match(/\$\{([^}]+)\}/);
			clientSecret = matchSec ? process.env[matchSec[1]] || '' : rawSec;

			const rawTok = existing.refresh_token || '';
			const matchTok = rawTok.match(/\$\{([^}]+)\}/);
			refreshToken = matchTok ? process.env[matchTok[1]] || '' : rawTok;
		}
	}

	if (!serviceId) {
		isNew = true;
		serviceId = `${baseId}-service`;

		const clientInput = await text({
			message: 'Enter your Google Client ID:',
			validate(value) {
				if (!value || !value.trim()) return 'Client ID is required';
			}
		});
		if (isCancel(clientInput)) return null;
		clientId = clientInput.trim();

		const secretInput = await password({
			message: 'Enter your Google Client Secret:',
			validate(value) {
				if (!value || !value.trim()) return 'Client Secret is required';
			}
		});
		if (isCancel(secretInput)) return null;
		clientSecret = secretInput.trim();

		const redirectUri = 'http://localhost';
		const authUrl = buildGoogleAuthUrl(clientId, redirectUri);
		console.log(`\n1. Open this link to authorize Google access:\n\n   ${authUrl}\n`);

		const rawInput = await text({
			message: 'Enter the authorization code (or paste the redirect URL):',
			validate(value) {
				if (!value || !value.trim()) return 'Authorization code or URL is required';
			}
		});
		if (isCancel(rawInput)) return null;
		const code = extractAuthCode(rawInput.trim());

		const sOauth = spinner();
		sOauth.start('Exchanging authorization code for tokens...');

		try {
			const tokens = await exchangeGoogleAuthCode(clientId, clientSecret, code, redirectUri);
			refreshToken = tokens.refresh_token;

			if (!refreshToken) {
				throw new Error(
					'Google did not return a refresh token. Revoke access to the app in your Google Account settings, or add "prompt=consent" manually.'
				);
			}
			sOauth.stop('Google account authenticated successfully!');
		} catch (err) {
			sOauth.stop('Failed!');
			const message = err instanceof Error ? err.message : String(err);
			note(
				`Error details:\n${message}\n\nPlease check your credentials and try again.`,
				'Authentication Failed'
			);
			return null;
		}

		const envId = baseId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
		envClientSecret = `WHEN_SERVICE_GOOGLE_${envId}_CLIENT_SECRET`;
		envRefreshToken = `WHEN_SERVICE_GOOGLE_${envId}_REFRESH_TOKEN`;
	}

	return {
		serviceId,
		clientId,
		clientSecret,
		refreshToken,
		isNew,
		envClientSecret,
		envRefreshToken
	};
}
