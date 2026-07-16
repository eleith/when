import { select, text, isCancel } from '@clack/prompts';
import { CredentialsAuthSchema } from '@when/config';
import { schemaDefault } from '../utils/schema-defaults.ts';
import { envRef, envVarName } from '../utils/env-ref.ts';

const OIDC_SECRET_VAR = 'WHEN_OIDC_CLIENT_SECRET';

export interface SectionResult {
	value: Record<string, unknown>;
	envVars: string[];
}

export async function promptAuth(): Promise<SectionResult | null> {
	const method = await select({
		message: 'How should the admin sign in?',
		options: [
			{ value: 'credentials', label: 'Username & password' },
			{ value: 'oidc', label: 'OIDC single sign-on' }
		],
		initialValue: 'credentials'
	});
	if (isCancel(method)) return null;

	if (method === 'credentials') {
		const username = await text({
			message: 'Admin username:',
			placeholder: 'admin',
			defaultValue: 'admin',
			validate(v) {
				if (!v || !v.trim()) return 'Username is required';
			}
		});
		if (isCancel(username)) return null;

		const passwordRef = schemaDefault<string>(CredentialsAuthSchema, 'password');
		return {
			value: { credentials: { username: username.trim(), password: passwordRef } },
			envVars: [envVarName(passwordRef)]
		};
	}

	const issuer = await text({
		message: 'OIDC issuer URL:',
		placeholder: 'https://accounts.example.com',
		validate(v) {
			if (!v || !v.trim()) return 'Issuer is required';
			try {
				new URL(v);
			} catch {
				return 'Must be a valid URL';
			}
		}
	});
	if (isCancel(issuer)) return null;

	const clientId = await text({
		message: 'OIDC client ID:',
		validate(v) {
			if (!v || !v.trim()) return 'Client ID is required';
		}
	});
	if (isCancel(clientId)) return null;

	return {
		value: {
			oidc: {
				issuer: issuer.trim(),
				client_id: clientId.trim(),
				client_secret: envRef(OIDC_SECRET_VAR)
			}
		},
		envVars: [OIDC_SECRET_VAR]
	};
}
