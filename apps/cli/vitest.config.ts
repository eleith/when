import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			thresholds: {
				statements: 80,
				branches: 60,
				functions: 85,
				lines: 80
			}
		}
	}
});
