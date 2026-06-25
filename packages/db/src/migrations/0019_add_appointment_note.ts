import { sql, type Kysely, type Migration } from 'kysely';

export const addAppointmentNote: Migration = {
	async up(db: Kysely<unknown>) {
		await sql`ALTER TABLE appointments ADD COLUMN note text`.execute(db);
	},
	async down(db: Kysely<unknown>) {
		await sql`ALTER TABLE appointments DROP COLUMN note`.execute(db);
	}
};
