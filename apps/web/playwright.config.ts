import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// E2E runs against its own config, port, and databases so it never reads or
// disturbs the developer's `config/when.yaml`, dev server, or `data/`.
// CONFIG_PATH also fixes the deployment root, which puts the fixture's SQLite
// files under `e2e/fixture/data/`.
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
		url: `http://localhost:${port}`,
		reuseExistingServer: !process.env.CI,
		// `vite preview` feeds .env into $env/dynamic/private only, never into
		// process.env, so boot's requireAuthSecret() sees nothing unless the
		// values are set on the spawned process here.
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
