import { join } from 'node:path';

// Do not inherit developer credentials, CONFIG_PATH, public assets or adapter settings.
export function serverEnvironment(directory: string): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH,
		WHEN_E2E_RUN_DIR: process.env.WHEN_E2E_RUN_DIR,
		NODE_ENV: 'production',
		TZ: 'UTC',
		CONFIG_PATH: join(directory, 'config', 'when.yaml'),
		WHEN_PUBLIC_DIR: join(directory, 'public'),
		AUTH_SECRET: 'e2e-auth-secret-not-used-outside-tests'
	};
}
