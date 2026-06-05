import { beforeEach, describe, expect, test, vi } from 'vitest';
import { declineAppointment } from './decline';
import { systemClock } from '$lib/server/clock';
import { openDb, runMigrations } from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('../workflow', () => ({ enqueueBookingEmail: vi.fn() }));
import { enqueueBookingEmail } from '../workflow';

const baseRow = {
	event_type_id: '30-min-chat',
	start_time: '2099-01-01T15:00:00Z',
	end_time: '2099-01-01T15:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_notes: null,
	location: null,
	external_event_id: null,
	external_calendar_id: null,
	email_notification_status: null,
	calendar_push_notification_status: null
};

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

async function fetchRow(db: Awaited<ReturnType<typeof makeDb>>, id: string) {
	return db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

describe('declineAppointment', () => {
	beforeEach(() => vi.mocked(enqueueBookingEmail).mockReset());

	test('happy path: pending → declined', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'd1', status: 'pending', cancel_token: 't1' })
				.execute();
			const row = await fetchRow(db, 'd1');

			const result = await declineAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row, baseUrl: 'https://when.example.com' }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.status).toBe('declined');
				const persisted = await fetchRow(db, 'd1');
				expect(persisted.status).toBe('declined');
				expect(persisted.email_notification_status).toBe('queued');
				expect(enqueueBookingEmail).toHaveBeenCalledWith(
					expect.objectContaining({ kind: 'declined' })
				);
			}
		} finally {
			await db.destroy();
		}
	});

	test('gated: confirmed booking cannot be declined', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'd2', status: 'confirmed', cancel_token: 't2' })
				.execute();
			const row = await fetchRow(db, 'd2');

			const result = await declineAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row, baseUrl: 'https://when.example.com' }
			);
			expect(result).toEqual({ ok: false, reason: 'gated' });
		} finally {
			await db.destroy();
		}
	});

	test('conflict: row already accepted by concurrent caller', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'd3', status: 'pending', cancel_token: 't3' })
				.execute();
			const row = await fetchRow(db, 'd3');
			await db
				.updateTable('appointments')
				.set({ status: 'confirmed' })
				.where('id', '=', 'd3')
				.execute();

			const result = await declineAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row, baseUrl: 'https://when.example.com' }
			);
			expect(result).toEqual({ ok: false, reason: 'conflict' });
		} finally {
			await db.destroy();
		}
	});
});
