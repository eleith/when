import Credentials from '@auth/sveltekit/providers/credentials';
import { verify as verifyArgon2 } from '@node-rs/argon2';
import type { WhenConfiguration } from '@when/config';

export function buildProviders(cfg: WhenConfiguration) {
	if ('credentials' in cfg.auth) {
		const { username, password_hash } = cfg.auth.credentials;
		return [
			Credentials({
				name: 'Password',
				credentials: {
					username: { label: 'Username', type: 'text' },
					password: { label: 'Password', type: 'password' }
				},
				async authorize(raw) {
					const u = typeof raw?.username === 'string' ? raw.username : '';
					const p = typeof raw?.password === 'string' ? raw.password : '';
					if (u !== username) return null;
					// @node-rs/argon2 verify takes (hash, password) — reversed from Bun's.
					const ok = await verifyArgon2(password_hash, p);
					return ok ? { id: 'admin', name: username } : null;
				}
			})
		];
	}

	const { issuer, client_id, client_secret } = cfg.auth.oidc;
	return [
		{
			id: 'oidc',
			name: 'Single Sign-On',
			type: 'oidc' as const,
			issuer,
			clientId: client_id,
			clientSecret: client_secret
		}
	];
}
