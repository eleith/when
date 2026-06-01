import { defineConfig } from 'vitest/config';

// The worker is a long-running Node service, not a web app. We build it as an
// SSR bundle: a single build/index.js run with `node`. Workspace packages are
// source TS, so bundle them (noExternal); everything else in node_modules
// (openworkflow, which dynamically requires node:sqlite) stays external.
export default defineConfig({
	build: {
		ssr: 'src/index.ts',
		outDir: 'build',
		target: 'node24',
		rollupOptions: {
			output: { entryFileNames: 'index.js' }
		}
	},
	ssr: {
		noExternal: [/^@when\//]
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
