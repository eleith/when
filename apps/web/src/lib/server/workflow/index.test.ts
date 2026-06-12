import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '@when/db';

const runWorkflow = vi.fn();

vi.mock('@when/jobs', () => ({
	getOpenWorkflow: () => ({ runWorkflow }),
	sendBookingEmail: { spec: { name: 'send-booking-email' } }
}));

import { enqueueBookingEmail } from './index';
import { sendBookingEmail } from '@when/jobs';

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
			attendee_name: 'Booker',
			attendee_email: 'booker@example.com',
			attendee_notes: null,
			location: null,
			status: 'confirmed',
			cancel_token: 't1'
		})
		.execute();
	return db;
}

describe('enqueueBookingEmail', () => {
	beforeEach(() => runWorkflow.mockReset());

	test('marks the email queued, snapshots the booking, and runs the workflow', async () => {
		const db = await seed();

		const result = await enqueueBookingEmail(db, 'appt-1', 'confirmed');

		expect(runWorkflow).toHaveBeenCalledWith(
			sendBookingEmail,
			{
				kind: 'confirmed',
				appointment: expect.objectContaining({ id: 'appt-1', email_notification_status: 'queued' })
			},
			{ idempotencyKey: 'appt-1:confirmed' }
		);
		const row = await db
			.selectFrom('appointments')
			.select('email_notification_status')
			.where('id', '=', 'appt-1')
			.executeTakeFirstOrThrow();
		expect(row.email_notification_status).toBe('queued');
		expect(result.email_notification_status).toBe('queued');

		await db.destroy();
	});
});
