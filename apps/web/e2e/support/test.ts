import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { test as base } from '@playwright/test';
import { serverEnvironment } from './environment.ts';
import { workerDirectory } from './paths.ts';
import { resetDatabases } from './database.ts';

export { expect } from '@playwright/test';
export type { Page, Locator, Request } from '@playwright/test';

async function stopServer(child: ChildProcess) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'exit');
	child.kill('SIGTERM');
	const kill = setTimeout(() => child.kill('SIGKILL'), 6_000);
	try {
		await exited;
	} finally {
		clearTimeout(kill);
	}
}

type AppServer = { origin: string; output: () => string };

export const test = base.extend<{ cleanDatabase: void }, { appServer: AppServer }>({
	appServer: [
		// Playwright requires destructuring even when a fixture has no dependencies.
		// eslint-disable-next-line no-empty-pattern
		async ({}, use) => {
			const child = fork(new URL('../server.mjs', import.meta.url), [], {
				env: serverEnvironment(workerDirectory()),
				execArgv: [],
				stdio: ['ignore', 'pipe', 'pipe', 'ipc']
			});
			let output = '';
			child.stdout!.on('data', (chunk) => (output = (output + chunk).slice(-50_000)));
			child.stderr!.on('data', (chunk) => (output = (output + chunk).slice(-50_000)));
			try {
				const origin = await new Promise<string>((resolve, reject) => {
					const timeout = setTimeout(
						() => reject(new Error('E2E server startup timed out')),
						30_000
					);
					child.once('message', (message: { origin: string }) => {
						clearTimeout(timeout);
						resolve(message.origin);
					});
					child.once('error', (error) => {
						clearTimeout(timeout);
						reject(error);
					});
					child.once('exit', (code, signal) => {
						clearTimeout(timeout);
						reject(new Error(`E2E server exited (${code ?? signal})`));
					});
				});
				const health = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(30_000) });
				if (!health.ok) throw new Error(`E2E server health: ${health.status}`);
				await use({ origin, output: () => output });
			} catch (error) {
				console.error(output);
				throw error;
			} finally {
				await stopServer(child);
			}
		},
		{ scope: 'worker', timeout: 60_000 }
	],
	baseURL: async ({ appServer }, use) => {
		await use(appServer.origin);
	},
	cleanDatabase: [
		async ({ appServer }, use, testInfo) => {
			let setupFailed = false;
			try {
				// Depend on the server so the real application has migrated both databases.
				resetDatabases();
				await use();
			} catch (error) {
				setupFailed = true;
				throw error;
			} finally {
				if (setupFailed || testInfo.status !== testInfo.expectedStatus) {
					const path = testInfo.outputPath('server.log');
					await writeFile(path, appServer.output());
					await testInfo.attach('server.log', { path, contentType: 'text/plain' });
				}
			}
		},
		{ auto: true }
	]
});
