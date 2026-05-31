import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Server/unit tests run in a plain Node environment without the SvelteKit Vite
// plugin. A couple of route files import via the `$lib` alias, so we map it here.
// E2E lives in Playwright (e2e/), excluded.
export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		globals: false
	}
});
