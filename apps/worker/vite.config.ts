import { defineConfig } from 'vitest/config';

// Vitest-only config. The worker builds with `tsc` (see tsconfig.build.json), not
// Vite — this just configures the test runner.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
