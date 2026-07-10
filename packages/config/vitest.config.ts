import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			thresholds: {
				statements: 80,
				branches: 80,
				functions: 80,
				lines: 80
			}
		}
	}
});
