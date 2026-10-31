import { afterEach, beforeEach, expect, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { WhenConfiguration } from '@when/config';
import { createHealthServer } from './health.js';

let server: Server;
let base: string;
let mockConfig: WhenConfiguration;

beforeEach(async () => {
	mockConfig = {
		prometheus: {
			enabled: false,
			token: 'test-token'
		}
	} as unknown as WhenConfiguration;

	server = createHealthServer(() => mockConfig);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const { port } = server.address() as AddressInfo;
	base = `http://127.0.0.1:${port}`;
});

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('GET /healthz returns 200 with ok status', async () => {
	const res = await fetch(`${base}/healthz`);
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ status: 'ok' });
});

test('unknown routes return 404', async () => {
	const res = await fetch(`${base}/nope`);
	expect(res.status).toBe(404);
});

test('GET /metrics returns 404 if prometheus is disabled', async () => {
	mockConfig.prometheus.enabled = false;
	const res = await fetch(`${base}/metrics`, {
		headers: { Authorization: 'Bearer test-token' }
	});
	expect(res.status).toBe(404);
});

test('GET /metrics returns 401 if missing Authorization header', async () => {
	mockConfig.prometheus.enabled = true;
	const res = await fetch(`${base}/metrics`);
	expect(res.status).toBe(401);
	expect(await res.text()).toBe('Unauthorized');
});

test('GET /metrics returns 401 if Authorization header is incorrect', async () => {
	mockConfig.prometheus.enabled = true;
	const res = await fetch(`${base}/metrics`, {
		headers: { Authorization: 'Bearer wrong-token' }
	});
	expect(res.status).toBe(401);
	expect(await res.text()).toBe('Unauthorized');
});

test('GET /metrics returns 200 with metrics if successfully authenticated', async () => {
	mockConfig.prometheus.enabled = true;
	const res = await fetch(`${base}/metrics`, {
		headers: { Authorization: 'Bearer test-token' }
	});
	expect(res.status).toBe(200);
	expect(res.headers.get('content-type')).toContain('text/plain');

	const text = await res.text();
	expect(text).toContain('when_jobs_total');
});

test('authenticated JSON snapshots retain application metadata', async () => {
	mockConfig.prometheus.enabled = true;
	const response = await fetch(`${base}/metrics`, {
		headers: { Authorization: 'Bearer test-token', Accept: 'application/json' }
	});
	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toContain('application/json');
	const snapshot = (await response.json()) as Array<{ name: string; type: string }>;
	expect(snapshot.find((metric) => metric.name === 'when_jobs_total')).toMatchObject({
		type: 'counter'
	});
});
