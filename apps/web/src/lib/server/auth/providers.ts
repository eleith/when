import { timingSafeEqual } from 'node:crypto';
import Credentials from '@auth/sveltekit/providers/credentials';
import type { CredentialsAuth, OidcAuth, WhenConfiguration } from '@when/config';
import { logger } from '../logger';

export function buildProviders(cfg: WhenConfiguration) {
	if (cfg.auth.credentials) return [credentialsProvider(cfg.auth.credentials)];
	if (cfg.auth.oidc) return [oidcProvider(cfg.auth.oidc)];
	return [];
}

function credentialsProvider(admin: CredentialsAuth) {
	if (process.env.NODE_ENV === 'production') {
		logger.warn(
			'credentials auth is enabled: this app applies no rate limiting or lockout to password attempts. That is fine on a trusted network; for an internet-facing deployment prefer OIDC, or put an authenticating proxy in front.'
		);
	}

	return Credentials({
		name: 'Password',
		credentials: {
			username: { label: 'Username', type: 'text' },
			password: { label: 'Password', type: 'password' }
		},
		authorize: async (submitted) => verifyCredentials(admin, submitted)
	});
}

function oidcProvider(oidc: OidcAuth) {
	return {
		id: 'oidc',
		name: oidc.name,
		type: 'oidc' as const,
		issuer: oidc.issuer,
		clientId: oidc.client_id,
		clientSecret: oidc.client_secret,
		checks: ['state'] as ['state']
	};
}

export function verifyCredentials(
	admin: CredentialsAuth,
	submitted: Partial<Record<string, unknown>> | undefined
): { id: string; name: string } | null {
	const username = typeof submitted?.username === 'string' ? submitted.username : '';
	const password = typeof submitted?.password === 'string' ? submitted.password : '';

	// Both compares always run: returning early on the username would time it.
	const okUsername = secretEquals(username, admin.username);
	const okPassword = secretEquals(password, admin.password);

	return okUsername && okPassword ? { id: 'admin', name: admin.username } : null;
}

// timingSafeEqual throws unless the buffers match in length, so length still leaks.
function secretEquals(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}
