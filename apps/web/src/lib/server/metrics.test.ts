import { expect, test } from 'vitest';
import { register } from './metrics';

test('register has default labels', async () => {
	const json = await register.getMetricsAsJSON();
	const firstMetric = json.find((m) => m.name === 'process_resident_memory_bytes');
	expect(firstMetric).toBeDefined();
	if (firstMetric) {
		const firstVal = firstMetric.values[0];
		expect(firstVal).toBeDefined();
		if (firstVal) {
			expect(firstVal.labels).toMatchObject({ app: 'when', service: 'web' });
		}
	}
});

test('low-value default metrics are pruned', async () => {
	const json = await register.getMetricsAsJSON();
	const names = json.map((m) => m.name);

	// High-value metrics we keep
	expect(names).toContain('process_resident_memory_bytes');
	expect(names).toContain('process_cpu_seconds_total');

	// Low-value metrics we prune
	expect(names).not.toContain('nodejs_active_handles');
	expect(names).not.toContain('nodejs_heap_space_size_total_bytes');
	expect(names).not.toContain('process_virtual_memory_bytes');
});

test('custom web metrics are registered', async () => {
	const json = await register.getMetricsAsJSON();
	const names = json.map((m) => m.name);

	expect(names).toContain('when_booking_attempts_total');
	expect(names).toContain('when_user_logins_total');
	expect(names).toContain('when_ics_downloads_total');
});
