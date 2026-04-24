import { SvelteKitAuth } from '@auth/sveltekit';
import type { WhenConfiguration } from '../config/schema';
import { buildProviders } from './providers';
import { requireAuthSecret } from './secret';

export { requireAuthSecret } from './secret';

const WEEK_SECONDS = 7 * 24 * 60 * 60;

type AuthModule = ReturnType<typeof SvelteKitAuth>;

let instance: AuthModule | null = null;

export function makeAuth(cfg: WhenConfiguration): AuthModule {
	const secret = requireAuthSecret();
	instance = SvelteKitAuth({
		secret,
		trustHost: true,
		session: { strategy: 'jwt', maxAge: WEEK_SECONDS },
		providers: buildProviders(cfg),
		pages: { signIn: '/signin' }
	});
	return instance;
}

export function getAuth(): AuthModule {
	if (!instance) throw new Error('auth not initialized — bootApp() must run first');
	return instance;
}
