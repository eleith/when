import { beforeEach, expect, test, vi } from 'vitest';
import { expireStalePending } from '@when/db';
import { expirePending } from '../services/appointments.js';
import { appointmentOperationsTotal } from './registry.js';

vi.mock('@when/db', () => ({ expireStalePending: vi.fn() }));

beforeEach(() => {
	vi.resetAllMocks();
	appointmentOperationsTotal.reset();
});

test('expiry counts invocations, including empty passes, not changed rows', async () => {
	vi.mocked(expireStalePending).mockResolvedValueOnce(5).mockResolvedValueOnce(0);
	const db = {} as Parameters<typeof expirePending>[0];
	expect(await expirePending(db, '2026-01-01T00:00:00Z')).toBe(5);
	expect(await expirePending(db, '2026-01-01T00:00:00Z')).toBe(0);
	expect((await appointmentOperationsTotal.get()).values).toEqual([
		expect.objectContaining({
			labels: { action: 'expire', actor: 'system', status: 'success' },
			value: 2
		})
	]);
	expect((await appointmentOperationsTotal.get()).help).toBe(
		'Appointment operation outcomes, not committed changes.'
	);
});

test('expiry counts errors and rethrows the original error unchanged', async () => {
	const error = { marker: 'original DB error' };
	vi.mocked(expireStalePending).mockRejectedValue(error);
	const db = {} as Parameters<typeof expirePending>[0];
	await expect(expirePending(db, '2026-01-01T00:00:00Z')).rejects.toBe(error);
	expect((await appointmentOperationsTotal.get()).values).toEqual([
		expect.objectContaining({
			labels: { action: 'expire', actor: 'system', status: 'error' },
			value: 1
		})
	]);
});
