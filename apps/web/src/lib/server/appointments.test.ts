import { expect, test } from 'vitest';
import { deriveDisplayStatus } from './appointments';

test('deriveDisplayStatus works for non-confirmed statuses', () => {
	const now = new Date('2026-06-15T12:00:00Z');
	expect(deriveDisplayStatus({ status: 'pending', start_time: '', end_time: '' }, now)).toBe(
		'pending'
	);
	expect(deriveDisplayStatus({ status: 'cancelled', start_time: '', end_time: '' }, now)).toBe(
		'cancelled'
	);
});

test('deriveDisplayStatus classifies confirmed statuses by time', () => {
	const now = new Date('2026-06-15T12:00:00Z');

	// Confirmed future
	expect(
		deriveDisplayStatus(
			{ status: 'confirmed', start_time: '2026-06-15T13:00:00Z', end_time: '2026-06-15T14:00:00Z' },
			now
		)
	).toBe('confirmed');

	// Confirmed in-progress
	expect(
		deriveDisplayStatus(
			{ status: 'confirmed', start_time: '2026-06-15T11:00:00Z', end_time: '2026-06-15T13:00:00Z' },
			now
		)
	).toBe('in_progress');

	// Confirmed concluded
	expect(
		deriveDisplayStatus(
			{ status: 'confirmed', start_time: '2026-06-15T10:00:00Z', end_time: '2026-06-15T11:00:00Z' },
			now
		)
	).toBe('concluded');
});
