import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			thresholds: {
				statements: 64,
				branches: 64,
				functions: 64,
				lines: 64
			}
		}
	}
});
