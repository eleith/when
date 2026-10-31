import type { BetterAuthOptions } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { userLoginsTotal } from './registry';

export function loginMetricsHooks(
	provider: 'credentials' | 'oidc'
): NonNullable<BetterAuthOptions['hooks']> {
	return {
		after: createAuthMiddleware(async (ctx) => {
			if (provider === 'credentials' && ctx.path !== '/sign-in/credentials') return;
			if (provider === 'oidc' && (ctx.path !== '/callback/:id' || ctx.params?.id !== 'oidc'))
				return;
			const status = ctx.context.newSession ? 'success' : 'failure';
			userLoginsTotal.inc({ provider, status });
		})
	};
}
