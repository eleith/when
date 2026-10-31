import { beforeEach, expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import { validConfig } from '../__fixtures__/valid-config';
import { systemClock } from '../clock';
import { createAppointment } from '../appointment-operations';
import { observeAppointmentOperation } from './appointments';
import { appointmentOperationsTotal } from './registry';

vi.mock('../workflow', () => ({ enqueueAppointmentReconciliation: vi.fn() }));
import { enqueueAppointmentReconciliation } from '../workflow';

beforeEach(() => {
	appointmentOperationsTotal.reset();
	vi.mocked(enqueueAppointmentReconciliation).mockReset();
});

test.each([
	{ result: { ok: true }, status: 'success' },
	{ result: { ok: false }, status: 'rejected' }
])('records $status without changing the operation result', async ({ result, status }) => {
	const operation = vi.fn(async (input: { actor: 'host' | 'guest' }) => ({
		...result,
		actor: input.actor
	}));
	const observed = observeAppointmentOperation('cancel', operation, (input) => input.actor);
	const input = { actor: 'host' as const };
	const output = await observed(input);
	expect(operation).toHaveBeenCalledExactlyOnceWith(input);
	expect(output).toEqual({ ...result, actor: 'host' });
	expect((await appointmentOperationsTotal.get()).values).toMatchObject([
		{ labels: { action: 'cancel', actor: 'host', status }, value: 1 }
	]);
});

test('records an error and rethrows the original exception', async () => {
	const failure = new Error('operation failed');
	const observed = observeAppointmentOperation(
		'accept',
		async () => {
			throw failure;
		},
		() => 'host'
	);
	await expect(observed()).rejects.toBe(failure);
	expect((await appointmentOperationsTotal.get()).values).toMatchObject([
		{ labels: { action: 'accept', actor: 'host', status: 'error' }, value: 1 }
	]);
});

test('the public create API records an error even when insertion committed before enqueue failed', async () => {
	const db = openDb(':memory:');
	await runMigrations(db);
	const failure = new Error('queue unavailable');
	vi.mocked(enqueueAppointmentReconciliation).mockRejectedValueOnce(failure);
	try {
		await expect(
			createAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{
					slug: '30-min-chat',
					eventType: validConfig.meetings['30-min-chat'],
					start: '2099-01-01T15:00:00Z',
					end: '2099-01-01T15:30:00Z',
					guest: { name: 'Booker', email: 'guest@example.test', answers: [], timezone: 'UTC' },
					location: null
				}
			)
		).rejects.toBe(failure);
		expect(await db.selectFrom('appointments').select('id').execute()).toHaveLength(1);
		expect((await appointmentOperationsTotal.get()).values).toMatchObject([
			{ labels: { action: 'create', actor: 'guest', status: 'error' }, value: 1 }
		]);
	} finally {
		await db.destroy();
	}
});
