import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			include: ['src/**/*.ts'],
			exclude: [...coverageConfigDefaults.exclude, 'src/index.ts'],
			thresholds: {
				statements: 80,
				branches: 60,
				functions: 85,
				lines: 80
			}
		}
	}
});
