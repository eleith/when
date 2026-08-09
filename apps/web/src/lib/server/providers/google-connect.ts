import type { Kysely } from 'kysely';
import type { GoogleProvider, WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import {
	buildGoogleAuthUrl,
	exchangeGoogleAuthCode,
	getGoogleAccessToken,
	revokeGoogleToken
} from '@when/calendar';
import { getProviderRefreshToken, deleteProviderToken } from '@when/db';

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

// The env var this app suggests for a provider's token, following the convention
// .env.example documents: the provider key, upper-cased, dashes as underscores.
export function refreshTokenEnvVar(providerName: string): string {
	return `WHEN_PROVIDER_${providerName.toUpperCase().replaceAll('-', '_')}_REFRESH_TOKEN`;
}

// Exchanges the one-time code and proves the resulting token actually works before
// handing it back to be shown. Nothing is stored: the token's home is the operator's
// env file, and a token that cannot mint an access token must not reach it — pasted
// into .env it would fail later, far from the flow that produced it.
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

// Removes the stored credential and ends it at Google. The row goes either way — a
// revoke that fails must not leave the provider stuck in a connected-but-unwanted state.
export async function disconnectGoogle(
	db: Kysely<Database>,
	providerName: string
): Promise<DisconnectResult> {
	const token = await getProviderRefreshToken(db, providerName);
	await deleteProviderToken(db, providerName);
	if (!token) return { revoked: true };

	try {
		await revokeGoogleToken(token);
		return { revoked: true };
	} catch (err) {
		return { revoked: false, reason: err instanceof Error ? err.message : String(err) };
	}
}
