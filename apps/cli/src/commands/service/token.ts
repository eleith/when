import { define } from 'gunshi';
import { text, isCancel } from '@clack/prompts';
import { getGoogleAccessToken, buildGoogleAuthUrl, exchangeGoogleAuthCode } from '@when/calendar';
import { interpolate, MissingEnvVarsError, type Service, type GoogleService } from '@when/config';
import { extractAuthCode } from '../../services/google.ts';
import { requireService, servicesAndName } from './shared.ts';
import { pass, fail, detail } from '../../utils/report.ts';

const REDIRECT_URI = 'http://localhost';

export const tokenCommand = define({
	name: 'token',
	description: 'mint a Google refresh token (google services only)',
	args: {
		name: { type: 'positional', required: false, description: 'the google service' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' },
		quiet: { type: 'boolean', description: 'print only the raw token' }
	},
	async run(ctx) {
		const resolved = await servicesAndName(ctx.values?.name, ctx.values?.config, 'token');
		if (resolved)
			await runServiceToken(resolved.services, resolved.name, ctx.values?.quiet === true);
	}
});

interface ClientCreds {
	clientId: string;
	clientSecret: string;
}

export async function runServiceToken(
	services: Service[],
	name: string,
	quiet: boolean
): Promise<void> {
	const service = requireService(services, name);
	if (!service) return;
	if (service.type !== 'google') {
		fail(`token is only for google services ("${name}" is ${service.type})`);
		return;
	}

	const creds = resolveClientCreds(service);
	if (!creds) return;

	const code = await promptAuthCode(creds.clientId);
	if (code === null) return;

	const refreshToken = await mintRefreshToken(creds, code);
	if (!refreshToken) return;

	reportToken(service, refreshToken, quiet);
}

function resolveClientCreds(service: GoogleService): ClientCreds | null {
	try {
		const resolved = interpolate({
			client_id: service.client_id,
			client_secret: service.client_secret
		});
		return { clientId: resolved.client_id, clientSecret: resolved.client_secret };
	} catch (err) {
		if (err instanceof MissingEnvVarsError) {
			fail(`${service.name} (google) — unset env var(s): ${err.missing.join(', ')}`);
			return null;
		}
		throw err;
	}
}

async function promptAuthCode(clientId: string): Promise<string | null> {
	const url = buildGoogleAuthUrl(clientId, REDIRECT_URI);
	console.log(`\nAuthorize access, then paste the code (or the redirected URL):\n  ${url}\n`);
	const input = await text({
		message: 'Authorization code or redirect URL:',
		validate(value) {
			if (!value || !value.trim()) return 'required';
		}
	});
	if (isCancel(input)) return null;
	return extractAuthCode(input.trim());
}

async function mintRefreshToken(creds: ClientCreds, code: string): Promise<string | null> {
	try {
		const { refresh_token } = await exchangeGoogleAuthCode(
			creds.clientId,
			creds.clientSecret,
			code,
			REDIRECT_URI
		);
		if (!refresh_token) {
			fail('Google returned no refresh token — revoke prior access and retry to force consent');
			return null;
		}
		await getGoogleAccessToken({
			client_id: creds.clientId,
			client_secret: creds.clientSecret,
			refresh_token,
			google_calendar_id: ''
		});
		return refresh_token;
	} catch (err) {
		fail(`token exchange failed — ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

function reportToken(service: GoogleService, refreshToken: string, quiet: boolean): void {
	if (quiet) {
		console.log(refreshToken);
		return;
	}
	pass(`${service.name} (google) — refresh token minted and verified`);
	detail('connect the service from the admin to store it; this copy is for --refresh-token');
	console.log(refreshToken);
}
