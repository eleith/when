import { randomBytes } from 'node:crypto';

export function resolveAuthSecret(
	configured?: string,
	env: NodeJS.ProcessEnv = process.env
): string {
	const secret = configured ?? env.AUTH_SECRET;
	if (secret === undefined) return randomBytes(32).toString('base64');
	if (secret.length < 32) {
		throw new Error('auth.secret or AUTH_SECRET must contain at least 32 characters');
	}
	return secret;
}
