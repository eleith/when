import { sql, type Kysely, type Migration } from 'kysely';

export const addAppointmentConference: Migration = {
	async up(db: Kysely<unknown>) {
		await sql`ALTER TABLE appointments ADD COLUMN conference text`.execute(db);
	},
	async down(db: Kysely<unknown>) {
		await sql`ALTER TABLE appointments DROP COLUMN conference`.execute(db);
	}
};
