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

export default defineConfig({
	plugins: [
		sveltekit(),
		Icons({
			compiler: 'svelte'
		})
	],
	server: {
		allowedHosts
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
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
