import type { GoogleProvider, WhenConfiguration } from '@when/config';
import {
	buildGoogleAuthUrl,
	exchangeGoogleAuthCode,
	getGoogleAccessToken,
	revokeGoogleToken
} from '@when/calendar';

// Registered with Google as the redirect URI, so it stays put even though the page it
// returns to moved to /admin/health.
export const CALLBACK_PATH = '/admin/services/google/callback';

export function googleRedirectUri(appUrl: string): string {
	return new URL(CALLBACK_PATH, appUrl).toString();
}

export function findGoogleProvider(config: WhenConfiguration, name: string): GoogleProvider | null {
	const provider = config.providers[name];
	return provider?.type === 'google' ? provider : null;
}

export function consentUrl(provider: GoogleProvider, appUrl: string, state: string): string {
	return buildGoogleAuthUrl({
		clientId: provider.client_id,
		redirectUri: googleRedirectUri(appUrl),
		state
	});
}

export type ConnectResult = { ok: true; refreshToken: string } | { ok: false; reason: string };

// The naming convention .env.example documents.
export function refreshTokenEnvVar(providerName: string): string {
	return `WHEN_PROVIDER_${providerName.toUpperCase().replaceAll('-', '_')}_REFRESH_TOKEN`;
}

// Verified first: a dud pasted into .env would fail far from here.
export async function exchangeGoogleConnect(
	provider: GoogleProvider,
	code: string,
	appUrl: string
): Promise<ConnectResult> {
	try {
		const { refresh_token } = await exchangeGoogleAuthCode(
			provider.client_id,
			provider.client_secret,
			code,
			googleRedirectUri(appUrl)
		);
		if (!refresh_token) {
			return {
				ok: false,
				reason:
					'Google returned no refresh token. Revoke the app under your Google account and try again.'
			};
		}

		await getGoogleAccessToken({
			client_id: provider.client_id,
			client_secret: provider.client_secret,
			refresh_token,
			google_calendar_id: ''
		});

		return { ok: true, refreshToken: refresh_token };
	} catch (err) {
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

export interface DisconnectResult {
	revoked: boolean;
	reason?: string;
}

// Kills the grant only; the app cannot write .env, so clearing it is theirs to do.
export async function disconnectGoogle(provider: GoogleProvider): Promise<DisconnectResult> {
	if (!provider.refresh_token) return { revoked: true };

	try {
		await revokeGoogleToken(provider.refresh_token);
		return { revoked: true };
	} catch (err) {
		return { revoked: false, reason: err instanceof Error ? err.message : String(err) };
	}
}
