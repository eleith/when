import type { WhenConfiguration } from '@when/config';
import { initOpenWorkflow, type WorkflowSpec } from '@when/jobs';
import { pass, fail } from './report.ts';

const RESULT_TIMEOUT_MS = 30_000;

export type WorkerRun<R> = { ok: true; value: R } | { ok: false; message: string };

// An unclaimed run sits pending until the result poll times out, so a stopped worker is
// worth naming before waiting half a minute for it.
export async function runInWorker<I, R>(
	config: WhenConfiguration,
	spec: WorkflowSpec<I, R>,
	input: I
): Promise<WorkerRun<R>> {
	const url = `${config.url.worker.replace(/\/$/, '')}/healthz`;
	try {
		const res = await fetch(url);
		if (!res.ok)
			return { ok: false, message: `worker unreachable at ${url} (status ${res.status})` };
	} catch {
		return { ok: false, message: `worker unreachable at ${url} — start the worker first` };
	}

	try {
		const client = initOpenWorkflow({ dbPath: config.database.queue });
		const handle = await client.runWorkflow(spec, input, { idempotencyKey: crypto.randomUUID() });
		return { ok: true, value: await handle.result({ timeoutMs: RESULT_TIMEOUT_MS }) };
	} catch (err) {
		return { ok: false, message: err instanceof Error ? err.message : String(err) };
	}
}

export async function reportWorkerRun<I, R>(
	config: WhenConfiguration,
	spec: WorkflowSpec<I, R>,
	input: I,
	label: string,
	describe: (value: R) => string
): Promise<void> {
	const run = await runInWorker(config, spec, input);
	if (run.ok) pass(`${label} — ${describe(run.value)}`);
	else fail(`${label} — ${run.message}`);
}
