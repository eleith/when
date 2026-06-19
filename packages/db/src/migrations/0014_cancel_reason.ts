import { sql, type Kysely, type Migration } from 'kysely';

export const cancelReason: Migration = {
	async up(db: Kysely<unknown>) {
		await sql`ALTER TABLE appointments ADD COLUMN cancel_reason text`.execute(db);
	},
	async down(db: Kysely<unknown>) {
		await sql`ALTER TABLE appointments DROP COLUMN cancel_reason`.execute(db);
	}
};
