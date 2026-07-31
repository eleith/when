import type { Kysely } from 'kysely';
import type { GoogleService, WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import {
	buildGoogleAuthUrl,
	exchangeGoogleAuthCode,
	getGoogleAccessToken,
	revokeGoogleToken
} from '@when/calendar';
import { saveServiceRefreshToken, getServiceRefreshToken, deleteServiceToken } from '@when/db';
import { logger } from '$lib/server/logger';

export const CALLBACK_PATH = '/admin/services/google/callback';

export function googleRedirectUri(appUrl: string): string {
	return new URL(CALLBACK_PATH, appUrl).toString();
}

export function findGoogleService(config: WhenConfiguration, name: string): GoogleService | null {
	const service = config.services?.find((s) => s.name === name);
	return service?.type === 'google' ? service : null;
}

export function consentUrl(service: GoogleService, appUrl: string, state: string): string {
	return buildGoogleAuthUrl({
		clientId: service.client_id,
		redirectUri: googleRedirectUri(appUrl),
		state
	});
}

export type ConnectResult = { ok: true } | { ok: false; reason: string };

// Exchanges the one-time code, proves the resulting token actually works, and only then
// stores it — a token that cannot mint an access token is worse than none, because the
// service would read as connected.
export async function completeGoogleConnect(
	db: Kysely<Database>,
	service: GoogleService,
	code: string,
	appUrl: string
): Promise<ConnectResult> {
	try {
		const { refresh_token } = await exchangeGoogleAuthCode(
			service.client_id,
			service.client_secret,
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
			client_id: service.client_id,
			client_secret: service.client_secret,
			refresh_token,
			google_calendar_id: ''
		});

		await retireToken(db, service.name, refresh_token);
		await saveServiceRefreshToken(db, service.name, refresh_token);
		return { ok: true };
	} catch (err) {
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

export interface DisconnectResult {
	revoked: boolean;
	reason?: string;
}

// Removes the stored credential and ends it at Google. The row goes either way — a
// revoke that fails must not leave the service stuck in a connected-but-unwanted state.
export async function disconnectGoogle(
	db: Kysely<Database>,
	serviceName: string
): Promise<DisconnectResult> {
	const token = await getServiceRefreshToken(db, serviceName);
	await deleteServiceToken(db, serviceName);
	if (!token) return { revoked: true };

	try {
		await revokeGoogleToken(token);
		return { revoked: true };
	} catch (err) {
		return { revoked: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

// Reconnecting mints a new token without invalidating the old one, which would otherwise
// accumulate against Google's per-client cap. Best effort: the new token already works.
async function retireToken(
	db: Kysely<Database>,
	serviceName: string,
	replacement: string
): Promise<void> {
	const previous = await getServiceRefreshToken(db, serviceName);
	if (!previous || previous === replacement) return;
	try {
		await revokeGoogleToken(previous);
	} catch (err) {
		logger.warn({ err, service: serviceName }, 'could not revoke the replaced google token');
	}
}
