import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// CONFIG_PATH below also sets the deployment root, which is what keeps the fixture's
// sqlite files out of the developer's apps/web/data/.
const port = 4183;
const configPath = fileURLToPath(new URL('./e2e/fixture/config/when.yaml', import.meta.url));

export default defineConfig({
	testDir: 'e2e',
	testMatch: /.*\.e2e\.ts$/,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	use: {
		baseURL: `http://localhost:${port}`,
		timezoneId: 'UTC',
		trace: 'on-first-retry'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: {
		command: `node e2e/reset-fixture.mjs && pnpm build && pnpm preview --port ${port}`,
		url: `http://localhost:${port}/healthz`,
		reuseExistingServer: !process.env.CI,
		// `vite preview` feeds .env into $env/dynamic/private only, never process.env,
		// which boot's requireAuthSecret() reads.
		env: {
			CONFIG_PATH: configPath,
			AUTH_SECRET: 'e2e-auth-secret-not-used-outside-tests',
			ENCRYPTION_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
			TZ: 'UTC'
		},
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 120_000
	}
});
