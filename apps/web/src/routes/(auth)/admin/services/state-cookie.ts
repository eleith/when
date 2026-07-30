import type { Cookies } from '@sveltejs/kit';

type CookieOptions = Parameters<Cookies['set']>[2];

export const STATE_COOKIE = 'when_google_oauth';

export interface OAuthState {
	state: string;
	service: string;
}

// sameSite must be 'lax', not 'strict': the browser arrives at the callback from
// accounts.google.com, and a strict cookie would not be sent on that navigation.
export function stateCookieOptions(dev: boolean): CookieOptions {
	return {
		path: '/admin/services',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: 600
	};
}

export function parseOAuthState(raw: string | undefined): OAuthState | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			typeof (parsed as OAuthState).state === 'string' &&
			typeof (parsed as OAuthState).service === 'string'
		) {
			return parsed as OAuthState;
		}
	} catch {
		// a malformed cookie is treated as no cookie
	}
	return null;
}
