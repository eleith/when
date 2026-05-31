export function requireAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
	const secret = env.AUTH_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error(
			'AUTH_SECRET env var is required and must be at least 32 characters (generate with `openssl rand -base64 32`)'
		);
	}
	return secret;
}
