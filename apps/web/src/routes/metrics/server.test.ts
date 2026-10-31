import { beforeEach, expect, test, vi } from 'vitest';
import { Counter, Histogram, Registry } from '@prometheus-io/client';
import type { RequestEvent } from './$types';
import { GET } from './+server';
import {
	appointmentOperationsTotal,
	operationFailuresTotal,
	register
} from '#lib/server/metrics/registry.js';

const mockConfig = {
	prometheus: { enabled: true, token: 'metrics-secret' },
	url: { worker: 'http://when-worker:9000' }
};
vi.mock('#lib/server/state.js', () => ({ getConfig: () => mockConfig }));
vi.mock('#lib/server/logger.js', () => ({ logger: { warn: vi.fn() } }));

beforeEach(() => {
	vi.clearAllMocks();
	mockConfig.prometheus.enabled = true;
	mockConfig.prometheus.token = 'metrics-secret';
	operationFailuresTotal.reset();
	appointmentOperationsTotal.reset();
});

function event(fetch: RequestEvent['fetch'], token = 'metrics-secret'): RequestEvent {
	return {
		request: new Request('http://when.example.test/metrics', {
			headers: { authorization: `Bearer ${token}` }
		}),
		fetch
	} as RequestEvent;
}

async function workerSnapshot() {
	const worker = new Registry();
	worker.setDefaultLabels({ app: 'when', service: 'worker' });
	new Counter({
		name: 'when_appointment_operations_total',
		help: 'Appointment operation outcomes, not committed changes.',
		labelNames: ['action', 'actor', 'status'],
		registers: [worker]
	}).inc({ action: 'expire', actor: 'system', status: 'success' });
	new Counter({
		name: 'when_jobs_total',
		help: 'Handler executions.',
		labelNames: ['job_name', 'status'],
		registers: [worker]
	}).inc({ job_name: 'deliverEmail', status: 'returned' }, 12);
	new Histogram({
		name: 'when_job_duration_seconds',
		help: 'Handler duration.',
		buckets: [1],
		registers: [worker]
	}).observe(0.5);
	return worker.getMetricsAsJSON();
}

test('returns 404 if prometheus is disabled without contacting the worker', async () => {
	mockConfig.prometheus.enabled = false;
	const fetch = vi.fn();
	await expect(GET(event(fetch))).rejects.toMatchObject({ status: 404 });
	expect(fetch).not.toHaveBeenCalled();
});

test('returns 401 if unauthorized without contacting the worker', async () => {
	const fetch = vi.fn();
	const response = await GET(event(fetch, 'wrong-secret'));
	expect(response.status).toBe(401);
	expect(fetch).not.toHaveBeenCalled();
});

test('returns 500 if enabled without a token', async () => {
	mockConfig.prometheus.token = '';
	const fetch = vi.fn();
	expect((await GET(event(fetch))).status).toBe(500);
	expect(fetch).not.toHaveBeenCalled();
});

test('natively aggregates JSON snapshots with service labels and histogram metadata intact', async () => {
	appointmentOperationsTotal.inc({ action: 'create', actor: 'guest', status: 'success' });
	const fetch = vi.fn().mockResolvedValue(Response.json(await workerSnapshot()));
	const response = await GET(event(fetch));
	const text = await response.text();
	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toBe(register.contentType);
	expect(text).toContain('when_booking_attempts_total');
	const lines = text.split('\n');
	const changes = lines.filter((line) => line.startsWith('when_appointment_operations_total{'));
	expect(changes).toHaveLength(2);
	const webChange = changes.find((line) => line.includes('service="web"'));
	const workerChange = changes.find((line) => line.includes('service="worker"'));
	expect(webChange).toContain('action="create"');
	expect(webChange).toContain('actor="guest"');
	expect(webChange).toContain('status="success"');
	expect(webChange).toContain('app="when"');
	expect(webChange).toMatch(/\} 1$/);
	expect(workerChange).toContain('action="expire"');
	expect(workerChange).toContain('actor="system"');
	expect(workerChange).toContain('status="success"');
	expect(workerChange).toContain('app="when"');
	expect(workerChange).toMatch(/\} 1$/);
	expect(
		lines.filter(
			(line) =>
				line ===
				'# HELP when_appointment_operations_total Appointment operation outcomes, not committed changes.'
		)
	).toHaveLength(1);
	expect(text.match(/^# TYPE when_appointment_operations_total counter$/gm) ?? []).toHaveLength(1);
	expect(text).toContain('# HELP when_jobs_total Handler executions.');
	expect(text).toContain('# TYPE when_jobs_total counter');
	expect(text).toContain('job_name="deliverEmail",status="returned"');
	expect(text).toContain('# HELP when_job_duration_seconds Handler duration.');
	expect(text).toContain('# TYPE when_job_duration_seconds histogram');
	expect(text).toMatch(/^when_job_duration_seconds_bucket\{[^}]*le="1"[^}]*\} 1$/m);
	expect(text).toMatch(/^when_job_duration_seconds_bucket\{[^}]*le="\+Inf"[^}]*\} 1$/m);
	expect(text).toMatch(/when_job_duration_seconds_sum\{[^\n]*\} 0\.5/);
	expect(text).toMatch(/when_job_duration_seconds_count\{[^\n]*\} 1/);
	expect(text).toMatch(/when_worker_scrape_success\{[^\n]*\} 1/);
	expect(fetch).toHaveBeenCalledWith('http://when-worker:9000/metrics', {
		headers: { authorization: 'Bearer metrics-secret', accept: 'application/json' },
		signal: expect.any(AbortSignal)
	});
});

test.each([
	{
		name: 'unauthorized worker',
		code: 'unauthorized',
		reply: () => Promise.resolve(new Response('Unauthorized', { status: 401 }))
	},
	{
		name: 'HTTP error',
		code: 'http_error',
		reply: () => Promise.resolve(new Response('Unavailable', { status: 503 }))
	},
	{
		name: 'malformed JSON',
		code: 'invalid_snapshot',
		reply: () => Promise.resolve(new Response('not JSON'))
	},
	{
		name: 'non-array snapshot',
		code: 'invalid_snapshot',
		reply: () => Promise.resolve(Response.json({ unexpected: true }))
	},
	{
		name: 'null sample',
		code: 'invalid_snapshot',
		reply: () =>
			Promise.resolve(
				Response.json([
					{
						name: 'bad',
						help: 'bad',
						type: 'gauge',
						aggregator: 'sum',
						values: [{ labels: { app: 'when', service: 'worker' }, value: null }]
					}
				])
			)
	},
	{
		name: 'unsupported metric type',
		code: 'invalid_snapshot',
		reply: async () => {
			const [metric] = await workerSnapshot();
			return Response.json([{ ...metric, type: 'unsupported' }]);
		}
	},
	{
		name: 'numeric string sample',
		code: 'invalid_snapshot',
		reply: async () => {
			const [metric] = await workerSnapshot();
			return Response.json([
				{ ...metric, values: metric.values.map((sample) => ({ ...sample, value: '1' })) }
			]);
		}
	},
	{
		name: 'conflicting web and worker types',
		code: 'invalid_snapshot',
		reply: async () => {
			const [metric] = await workerSnapshot();
			return Response.json([{ ...metric, type: 'gauge' }]);
		}
	},
	{
		name: 'fetch timeout',
		code: 'timeout',
		reply: () => Promise.reject(new DOMException('Timed out', 'TimeoutError'))
	},
	{
		name: 'fetch connection failure',
		code: 'transport_error',
		reply: () => Promise.reject(new Error('Connection failed'))
	},
	{
		name: 'body timeout after successful headers',
		code: 'timeout',
		reply: () =>
			Promise.resolve(
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new DOMException('Timed out', 'TimeoutError'));
						}
					})
				)
			)
	},
	{
		name: 'interrupted body after successful headers',
		code: 'transport_error',
		reply: () =>
			Promise.resolve(
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new TypeError('Body connection interrupted'));
						}
					})
				)
			)
	}
])('returns truthful web-only metrics for $name', async ({ code, reply }) => {
	const response = await GET(event(vi.fn().mockImplementation(reply)));
	const text = await response.text();
	expect(response.status).toBe(200);
	expect(text).toContain('when_booking_attempts_total');
	expect(text).not.toContain('when_jobs_total');
	expect(text).toMatch(/when_worker_scrape_success\{[^\n]*\} 0/);
	const failure = text
		.split('\n')
		.find(
			(line) => line.startsWith('when_operation_failures_total{') && line.includes(`code="${code}"`)
		);
	expect(failure).toContain('operation="worker_scrape"');
	expect(failure).toMatch(/\} 1$/);
});

test('collects web metrics during a worker request and keeps overlapping scrapes independent', async () => {
	let release!: (response: Response) => void;
	const delayed = new Promise<Response>((resolve) => {
		release = resolve;
	});
	const collectWeb = vi.spyOn(register, 'getMetricsAsJSON');
	try {
		const first = GET(event(vi.fn().mockReturnValue(delayed)));
		const webCollectionsWhileWorkerPending = collectWeb.mock.calls.length;
		const healthy = await GET(
			event(vi.fn().mockResolvedValue(Response.json(await workerSnapshot())))
		);
		release(new Response('Unavailable', { status: 503 }));
		const failed = await first;
		const failedText = await failed.text();
		expect(webCollectionsWhileWorkerPending).toBe(1);
		expect(await healthy.text()).toMatch(/when_worker_scrape_success\{[^\n]*\} 1/);
		expect(failedText).toMatch(/when_worker_scrape_success\{[^\n]*\} 0/);
		expect(failedText).toMatch(/^when_operation_failures_total\{[^}]*code="http_error"[^}]*\} 1$/m);
	} finally {
		release(new Response('Unavailable', { status: 503 }));
		collectWeb.mockRestore();
	}
});
