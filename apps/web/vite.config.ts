import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import Icons from 'unplugin-icons/vite';

// Dev-server host allowlist (Vite dev/preview only — prod runs adapter-node).
// localhost and IPs are always allowed by Vite; the dev environment declares any
// extra hosts (e.g. the docker service name the worker uses to reach web).
const allowedHosts = (process.env.WHEN_ALLOWED_HOSTS ?? '')
	.split(',')
	.map((host) => host.trim())
	.filter(Boolean);

export default defineConfig(({ command }) => {
	// Dev server only (not `vite build`, not vitest): run @when/* from source.
	const sourceFirst = command === 'serve' && !process.env.VITEST;

	return {
		plugins: [
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter(),
				inlineStyleThreshold: 10240,
				csp: {
					directives: {
						'default-src': ['self'],
						'script-src': ['self'],
						// The theme <style> is injected after Kit has hashed the page.
						'style-src': ['self', 'unsafe-inline'],
						'img-src': ['self', 'data:'],
						'font-src': ['self'],
						'connect-src': ['self'],
						'object-src': ['none'],
						'base-uri': ['self'],
						'form-action': ['self', 'https://accounts.google.com'],
						'frame-ancestors': ['none']
					}
				}
			}),
			Icons({ compiler: 'svelte' })
		],
		server: {
			allowedHosts
		},
		// noExternal makes Vite transform the packages' TS rather than hand it to Node.
		ssr: sourceFirst ? { noExternal: [/^@when\//] } : {},
		test: {
			include: ['src/**/*.test.ts'],
			environment: 'node',
			coverage: {
				include: ['src/**/*.ts'],
				thresholds: {
					statements: 70,
					branches: 68,
					functions: 72,
					lines: 70
				}
			}
		}
	};
});
