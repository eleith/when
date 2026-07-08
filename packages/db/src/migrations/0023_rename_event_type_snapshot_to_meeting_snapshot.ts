import { sql, type Kysely, type Migration } from 'kysely';

export const renameEventTypeSnapshotToMeetingSnapshot: Migration = {
	async up(db: Kysely<unknown>) {
		await sql`ALTER TABLE appointments RENAME COLUMN event_type_snapshot TO meeting_snapshot`.execute(
			db
		);
	},
	async down(db: Kysely<unknown>) {
		await sql`ALTER TABLE appointments RENAME COLUMN meeting_snapshot TO event_type_snapshot`.execute(
			db
		);
	}
};
