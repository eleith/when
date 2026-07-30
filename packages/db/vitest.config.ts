import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			include: ['src/**/*.ts'],
			// Migrations are write-once and run against a schema, not a call graph. Covering
			// them means asserting column shapes a migration just declared, and every Kysely
			// column callback counts as a function, so each new migration taxes the ratio.
			exclude: ['src/migrations/**'],
			thresholds: {
				statements: 80,
				branches: 80,
				functions: 80,
				lines: 80
			}
		}
	}
});
