import { afterEach, beforeEach, expect, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHealthServer } from './health.js';

let server: Server;
let base: string;

beforeEach(async () => {
	server = createHealthServer();
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const { port } = server.address() as AddressInfo;
	base = `http://127.0.0.1:${port}`;
});

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('GET /health returns 200 with ok status', async () => {
	const res = await fetch(`${base}/health`);
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ status: 'ok' });
});

test('unknown routes return 404', async () => {
	const res = await fetch(`${base}/nope`);
	expect(res.status).toBe(404);
});
