import { expect, test } from 'vitest';
import { register } from './metrics.js';

test('registry default labels are set correctly', async () => {
	const json = await register.getMetricsAsJSON();
	// Default labels should be attached to registered metrics
	const firstMetric = json.find((m) => m.name === 'nodejs_resident_memory_bytes');
	expect(firstMetric).toBeDefined();
	if (firstMetric) {
		const firstVal = firstMetric.values[0];
		expect(firstVal).toBeDefined();
		if (firstVal) {
			expect(firstVal.labels).toMatchObject({ app: 'when', service: 'worker' });
		}
	}
});

test('low-value default metrics are pruned', async () => {
	const json = await register.getMetricsAsJSON();
	const names = json.map((m) => m.name);

	// High-value metrics we keep
	expect(names).toContain('nodejs_resident_memory_bytes');
	expect(names).toContain('process_cpu_seconds_total');

	// Low-value metrics we prune
	expect(names).not.toContain('nodejs_active_handles');
	expect(names).not.toContain('nodejs_heap_space_size_bytes_total');
	expect(names).not.toContain('process_virtual_memory_bytes');
});

test('custom worker metrics are registered', async () => {
	const json = await register.getMetricsAsJSON();
	const names = json.map((m) => m.name);

	expect(names).toContain('when_jobs_total');
	expect(names).toContain('when_job_duration_seconds');
	expect(names).toContain('when_jobs_active');
	expect(names).toContain('when_emails_total');
	expect(names).toContain('when_calendar_sync_total');
	expect(names).toContain('when_calendar_sync_duration_seconds');
	expect(names).toContain('when_calendar_refresh_total');
});
