import { execFile } from 'node:child_process';
import { access, cp, mkdtemp, mkdir, copyFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { serverEnvironment } from './support/environment.ts';

const webDirectory = fileURLToPath(new URL('..', import.meta.url));

export default async function setup() {
	const runsDirectory = join(webDirectory, 'e2e/fixture/data');
	await mkdir(runsDirectory, { recursive: true });
	const directory = await mkdtemp(join(runsDirectory, 'run-'));
	process.env.WHEN_E2E_RUN_DIR = directory;
	const cleanup = () => rm(directory, { recursive: true, force: true });
	try {
		const projectDirectory = join(directory, 'project');
		await mkdir(join(projectDirectory, 'config'), { recursive: true });
		// Kit's post-build workers rediscover config from cwd. Build a fresh copy
		// with the normal configs, rather than overriding paths in one build phase.
		for (const path of ['src', 'static', 'package.json', 'vite.config.ts', 'tsconfig.json']) {
			await cp(join(webDirectory, path), join(projectDirectory, path), { recursive: true });
		}
		await symlink(
			join(webDirectory, 'node_modules'),
			join(projectDirectory, 'node_modules'),
			'dir'
		);
		await copyFile(
			join(webDirectory, 'e2e/fixture/config/when.yaml'),
			join(projectDirectory, 'config/when.yaml')
		);
		await promisify(execFile)(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
			cwd: projectDirectory,
			env: serverEnvironment(projectDirectory),
			timeout: 120_000,
			maxBuffer: 10 * 1024 * 1024
		});
		// Fail once at setup, rather than starting every test against a missing build.
		await access(join(projectDirectory, 'build/handler.js'));
		return cleanup;
	} catch (error) {
		await cleanup();
		throw error;
	}
}
