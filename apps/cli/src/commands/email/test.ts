import { define } from 'gunshi';
import { testEmail } from '@when/jobs';
import { requireConfigPath } from '../../utils/config-path.ts';
import { loadConfigFully } from '../../utils/load.ts';
import { pass, fail } from '../../utils/report.ts';
import { runInWorker } from '../../utils/worker.ts';

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
	const config = await loadConfigFully(configPath);
	if (!config) return;

	const run = await runInWorker(config, testEmail, { to: address });
	if (run.ok) pass(`test email sent to ${address}`);
	else fail(`test email failed — ${run.message}`);
}
