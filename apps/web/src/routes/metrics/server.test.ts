import { describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from './$types';
import { GET } from './+server';
import { register } from '$lib/server/metrics';

const mockConfig = {
	prometheus: {
		enabled: true,
		token: 'metrics-secret'
	},
	url: {
		worker: 'http://when-worker:9000'
	}
};

vi.mock('$lib/server/state', () => ({
	getConfig: () => mockConfig
}));

describe('GET /metrics scrape aggregator endpoint', () => {
	test('returns 404 if prometheus is disabled', async () => {
		mockConfig.prometheus.enabled = false;

		const mockRequest = {
			headers: {
				get: () => 'Bearer metrics-secret'
			}
		} as unknown as Request;

		await expect(
			GET({
				request: mockRequest,
				fetch: vi.fn()
			} as unknown as RequestEvent)
		).rejects.toThrow();
	});

	test('returns 401 if unauthorized', async () => {
		mockConfig.prometheus.enabled = true;

		const mockRequest = {
			headers: {
				get: (h: string) => (h === 'authorization' ? 'Bearer wrong-secret' : null)
			}
		} as unknown as Request;

		const res = await GET({
			request: mockRequest,
			fetch: vi.fn()
		} as unknown as RequestEvent);

		expect(res.status).toBe(401);
		expect(await res.text()).toBe('Unauthorized');
	});

	test('returns 200 with merged metrics and stripped worker comments on success', async () => {
		mockConfig.prometheus.enabled = true;

		const mockRequest = {
			headers: {
				get: (h: string) => (h === 'authorization' ? 'Bearer metrics-secret' : null)
			}
		} as unknown as Request;

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				`# HELP when_jobs_total Total jobs.\n# TYPE when_jobs_total counter\nwhen_jobs_total{job_name="sendAppointmentEmail",status="success"} 12`
		});

		const res = await GET({
			request: mockRequest,
			fetch: mockFetch
		} as unknown as RequestEvent);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe(register.contentType);

		const text = await res.text();
		// Web metrics should be present
		expect(text).toContain('process_resident_memory_bytes');
		// Custom web metrics should be present
		expect(text).toContain('when_booking_attempts_total');
		// Worker metrics should be present
		expect(text).toContain('when_jobs_total');
		// Helper/type comments from worker metrics must be stripped
		expect(text).not.toContain('# HELP when_jobs_total');
		expect(text).not.toContain('# TYPE when_jobs_total');

		expect(mockFetch).toHaveBeenCalledWith('http://when-worker:9000/metrics', {
			headers: {
				authorization: 'Bearer metrics-secret'
			},
			signal: expect.any(AbortSignal)
		});
	});

	test('returns web-only metrics if worker fetch fails', async () => {
		mockConfig.prometheus.enabled = true;

		const mockRequest = {
			headers: {
				get: (h: string) => (h === 'authorization' ? 'Bearer metrics-secret' : null)
			}
		} as unknown as Request;

		const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

		const res = await GET({
			request: mockRequest,
			fetch: mockFetch
		} as unknown as RequestEvent);

		expect(res.status).toBe(200);
		const text = await res.text();
		// Web metrics should still be served
		expect(text).toContain('process_resident_memory_bytes');
		// Worker metrics are not present
		expect(text).not.toContain('when_jobs_total');
	});
});
