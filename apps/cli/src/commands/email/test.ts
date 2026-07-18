import { define } from 'gunshi';
import {
	loadConfigFile,
	ConfigError,
	MissingEnvVarsError,
	type WhenConfiguration
} from '@when/config';
import { initOpenWorkflow, testEmail } from '@when/jobs';
import { requireConfigPath } from '../../utils/config-path.ts';
import { pass, fail } from '../../utils/report.ts';

const RESULT_TIMEOUT_MS = 30_000;

export const testCommand = define({
	name: 'test',
	description: 'render + send a test email via the worker',
	args: {
		address: { type: 'positional', required: false, description: 'recipient email address' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	async run(ctx) {
		const address = ctx.values?.address as string | undefined;
		if (!address) {
			fail('email test requires a recipient address');
			return;
		}
		const configPath = requireConfigPath(ctx.values?.config);
		if (!configPath) return;
		await runEmailTest(configPath, address);
	}
});

export async function runEmailTest(configPath: string, address: string): Promise<void> {
	const config = await loadConfig(configPath);
	if (!config) return;

	if (!(await workerReachable(config.url.worker))) return;

	try {
		const client = initOpenWorkflow({ dbPath: config.database.queue });
		const handle = await client.runWorkflow(
			testEmail,
			{ to: address },
			{ idempotencyKey: crypto.randomUUID() }
		);
		await handle.result({ timeoutMs: RESULT_TIMEOUT_MS });
		pass(`test email sent to ${address}`);
	} catch (err) {
		fail(`test email failed — ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function loadConfig(configPath: string): Promise<WhenConfiguration | null> {
	try {
		return await loadConfigFile(configPath);
	} catch (err) {
		if (err instanceof ConfigError) {
			fail('config is not valid — run when-cli config validate');
			return null;
		}
		if (err instanceof MissingEnvVarsError) {
			fail(`config env not fully set: ${err.missing.join(', ')}`);
			return null;
		}
		throw err;
	}
}

async function workerReachable(workerUrl: string): Promise<boolean> {
	const url = `${workerUrl.replace(/\/$/, '')}/healthz`;
	try {
		const res = await fetch(url);
		if (res.ok) return true;
		fail(`worker unreachable at ${url} (status ${res.status}) — start the worker first`);
		return false;
	} catch {
		fail(`worker unreachable at ${url} — start the worker first`);
		return false;
	}
}
