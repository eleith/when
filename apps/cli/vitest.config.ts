import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			thresholds: {
				statements: 25,
				branches: 25,
				functions: 25,
				lines: 25
			}
		}
	}
});
