import Credentials from '@auth/sveltekit/providers/credentials';
import type { WhenConfiguration } from '../config/schema';

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
					const ok = await Bun.password.verify(p, password_hash);
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
