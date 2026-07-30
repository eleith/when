import type { Kysely } from 'kysely';
import type { GoogleService, WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import { buildGoogleAuthUrl, exchangeGoogleAuthCode, getGoogleAccessToken } from '@when/calendar';
import { saveServiceRefreshToken, listServiceConnections } from '@when/db';

export const CALLBACK_PATH = '/admin/services/google/callback';

export interface GoogleServiceView {
	name: string;
	connectedAt: string | null;
	lastError: string | null;
}

export function googleRedirectUri(appUrl: string): string {
	return new URL(CALLBACK_PATH, appUrl).toString();
}

export function findGoogleService(config: WhenConfiguration, name: string): GoogleService | null {
	const service = config.services?.find((s) => s.name === name);
	return service?.type === 'google' ? service : null;
}

export async function listGoogleServices(
	config: WhenConfiguration,
	db: Kysely<Database>
): Promise<GoogleServiceView[]> {
	const connections = new Map((await listServiceConnections(db)).map((c) => [c.serviceName, c]));
	return (config.services ?? [])
		.filter((s) => s.type === 'google')
		.map((s) => ({
			name: s.name,
			connectedAt: connections.get(s.name)?.connectedAt ?? null,
			lastError: connections.get(s.name)?.lastError ?? null
		}));
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

		await saveServiceRefreshToken(db, service.name, refresh_token);
		return { ok: true };
	} catch (err) {
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
}
