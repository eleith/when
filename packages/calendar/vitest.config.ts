import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			include: ['src/**/*.ts'],
			thresholds: {
				statements: 68,
				branches: 68,
				functions: 68,
				lines: 68
			}
		}
	}
});
