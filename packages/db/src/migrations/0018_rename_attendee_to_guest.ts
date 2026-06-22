import { sql, type Kysely, type Migration } from 'kysely';

const columns: ReadonlyArray<[attendee: string, guest: string]> = [
	['attendee_name', 'guest_name'],
	['attendee_email', 'guest_email'],
	['attendee_answers', 'guest_answers'],
	['attendee_timezone', 'guest_timezone']
];

export const renameAttendeeToGuest: Migration = {
	async up(db: Kysely<unknown>) {
		for (const [from, to] of columns) {
			await db.schema.alterTable('appointments').renameColumn(from, to).execute();
		}
		// Rewrite the actor role recorded in stored action_log JSON.
		await sql`UPDATE appointments SET action_log = REPLACE(REPLACE(action_log,
			'"actor":"attendee"', '"actor":"guest"'),
			'"actor":"organizer"', '"actor":"host"')
			WHERE action_log IS NOT NULL`.execute(db);
		// Rewrite the renamed form-field types stored in answers and event snapshots.
		await sql`UPDATE appointments SET guest_answers = REPLACE(REPLACE(guest_answers,
			'"type":"attendee_name"', '"type":"guest_name"'),
			'"type":"attendee_email"', '"type":"guest_email"')
			WHERE guest_answers IS NOT NULL`.execute(db);
		await sql`UPDATE appointments SET event_type_snapshot = REPLACE(REPLACE(event_type_snapshot,
			'"type":"attendee_name"', '"type":"guest_name"'),
			'"type":"attendee_email"', '"type":"guest_email"')
			WHERE event_type_snapshot IS NOT NULL`.execute(db);
	},
	async down(db: Kysely<unknown>) {
		await sql`UPDATE appointments SET event_type_snapshot = REPLACE(REPLACE(event_type_snapshot,
			'"type":"guest_name"', '"type":"attendee_name"'),
			'"type":"guest_email"', '"type":"attendee_email"')
			WHERE event_type_snapshot IS NOT NULL`.execute(db);
		await sql`UPDATE appointments SET guest_answers = REPLACE(REPLACE(guest_answers,
			'"type":"guest_name"', '"type":"attendee_name"'),
			'"type":"guest_email"', '"type":"attendee_email"')
			WHERE guest_answers IS NOT NULL`.execute(db);
		await sql`UPDATE appointments SET action_log = REPLACE(REPLACE(action_log,
			'"actor":"guest"', '"actor":"attendee"'),
			'"actor":"host"', '"actor":"organizer"')
			WHERE action_log IS NOT NULL`.execute(db);
		for (const [from, to] of columns) {
			await db.schema.alterTable('appointments').renameColumn(to, from).execute();
		}
	}
};
