import { expect, test } from 'vitest';
import { bookingAttemptsTotal, register } from './registry';

test('register has default labels', async () => {
	bookingAttemptsTotal.inc({ event_type_id: 'test-meeting', status: 'success' });
	try {
		const json = await register.getMetricsAsJSON();
		expect(
			json.find((metric) => metric.name === 'when_booking_attempts_total')?.values
		).toMatchObject([
			{
				labels: { app: 'when', service: 'web', event_type_id: 'test-meeting', status: 'success' },
				value: 1
			}
		]);
	} finally {
		bookingAttemptsTotal.reset();
	}
});

test('only application metrics are registered', async () => {
	const json = await register.getMetricsAsJSON();
	expect(json.map((metric) => metric.name).sort()).toEqual([
		'when_appointment_operations_total',
		'when_booking_attempts_total',
		'when_ics_downloads_total',
		'when_operation_failures_total',
		'when_user_logins_total'
	]);
});
