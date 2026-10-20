import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import * as jobs from '@when/jobs';
import { runInWorker } from './worker.ts';

afterEach(() => vi.restoreAllMocks());

test('CLI initializes only a producer and gives each probe its own random enqueue key', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'when-cli-producer-'));
	const dbPath = join(directory, 'queue.sqlite');
	const config = {
		database: { queue: dbPath },
		url: { worker: 'http://worker.example.com:9000/' }
	} as WhenConfiguration;
	const client = jobs.initOpenWorkflow({ dbPath });
	const init = vi.spyOn(jobs, 'initOpenWorkflow');
	const newWorker = vi.spyOn(client, 'newWorker');
	const implement = vi.spyOn(client, 'implementWorkflow');
	const schedule = vi.spyOn(client, 'scheduleWorkflow');
	const result = vi.fn().mockResolvedValue('authenticated');
	const enqueue = client.runWorkflow.bind(client);
	const run = vi.spyOn(client, 'runWorkflow').mockImplementation(async (...args) => {
		const handle = await enqueue(...args);
		vi.spyOn(handle, 'result').mockImplementation(result);
		return handle;
	});
	const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));
	const uuid = vi.spyOn(crypto, 'randomUUID');
	uuid.mockReturnValueOnce('00000000-0000-4000-8000-000000000001');
	uuid.mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
	try {
		for (let i = 1; i <= 2; i++) {
			const probeResult = await runInWorker(config, jobs.testProvider, { name: 'work' });
			expect(probeResult).toEqual({
				ok: true,
				value: 'authenticated'
			});
			expect(run).toHaveBeenNthCalledWith(
				i,
				jobs.testProvider,
				{ name: 'work' },
				{ idempotencyKey: `00000000-0000-4000-8000-00000000000${i}` }
			);
		}
		expect(jobs.testProvider.name).toBe('test-provider');
		expect(init).toHaveBeenCalledTimes(2);
		expect(init).toHaveBeenCalledWith({ dbPath });
		expect(fetch).toHaveBeenCalledWith('http://worker.example.com:9000/healthz');
		expect(result).toHaveBeenCalledTimes(2);
		expect(result).toHaveBeenCalledWith({ timeoutMs: 30_000 });
		expect(newWorker).not.toHaveBeenCalled();
		expect(implement).not.toHaveBeenCalled();
		expect(schedule).not.toHaveBeenCalled();
		const raw = new DatabaseSync(dbPath, { readOnly: true });
		try {
			expect(raw.prepare('SELECT COUNT(*) AS count FROM workflow_schedules').get()).toEqual({
				count: 0
			});
			expect(raw.prepare('SELECT workflow_name, status, input FROM workflow_runs').all()).toEqual(
				Array.from({ length: 2 }, () => ({
					workflow_name: 'test-provider',
					status: 'pending',
					input: '{"name":"work"}'
				}))
			);
		} finally {
			raw.close();
		}
	} finally {
		await jobs.closeOpenWorkflow();
		await rm(directory, { recursive: true, force: true });
	}
});
