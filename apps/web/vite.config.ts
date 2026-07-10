import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import Icons from 'unplugin-icons/vite';
import { loadConfigFile } from '@when/config';

function hostFrom(value: string): string | null {
	try {
		return new URL(value.includes('://') ? value : `http://${value}`).hostname;
	} catch {
		return null;
	}
}

async function allowedHosts(): Promise<string[]> {
	try {
		const cfg = await loadConfigFile();
		const hosts = [cfg.url.app, cfg.url.internal]
			.map((value) => hostFrom(value))
			.filter((host): host is string => host !== null);
		return [...new Set(hosts)];
	} catch {
		return [];
	}
}

export default defineConfig(async () => ({
	plugins: [
		sveltekit(),
		Icons({
			compiler: 'svelte'
		})
	],
	server: {
		allowedHosts: await allowedHosts()
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
}));
