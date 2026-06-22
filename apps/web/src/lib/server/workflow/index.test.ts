import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '@when/db';

const runWorkflow = vi.fn();

vi.mock('@when/jobs', () => ({
	getOpenWorkflow: () => ({ runWorkflow }),
	sendAppointmentEmail: { spec: { name: 'send-appointment-email' } }
}));

import { enqueueAppointmentEmail } from './index';
import { sendAppointmentEmail } from '@when/jobs';

async function seed() {
	const db = openDb(':memory:');
	await runMigrations(db);
	await db
		.insertInto('appointments')
		.values({
			id: 'appt-1',
			event_type_id: '30-min',
			start_time: '2099-01-01T15:00:00Z',
			end_time: '2099-01-01T15:30:00Z',
			guest_name: 'Booker',
			guest_email: 'booker@example.com',
			guest_answers: null,
			location: null,
			status: 'confirmed',
			cancel_token: 't1'
		})
		.execute();
	return db;
}

describe('enqueueAppointmentEmail', () => {
	beforeEach(() => runWorkflow.mockReset());

	test('snapshots the appointment and runs the workflow', async () => {
		const db = await seed();

		const result = await enqueueAppointmentEmail(db, 'appt-1', 'confirmed');

		expect(runWorkflow).toHaveBeenCalledWith(
			sendAppointmentEmail,
			{
				kind: 'confirmed',
				appointment: expect.objectContaining({ id: 'appt-1' })
			},
			{ idempotencyKey: 'appt-1:confirmed:0' }
		);
		expect(result.id).toBe('appt-1');

		await db.destroy();
	});

	test('keys by ics_sequence so a repeat same-kind send is not deduped', async () => {
		const db = await seed();
		await db
			.updateTable('appointments')
			.set({ ics_sequence: 2 })
			.where('id', '=', 'appt-1')
			.execute();

		await enqueueAppointmentEmail(db, 'appt-1', 'rescheduled-by-guest');

		expect(runWorkflow).toHaveBeenCalledWith(sendAppointmentEmail, expect.anything(), {
			idempotencyKey: 'appt-1:rescheduled-by-guest:2'
		});

		await db.destroy();
	});
});
