import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			thresholds: {
				statements: 75,
				branches: 75,
				functions: 75,
				lines: 75
			}
		}
	}
});
