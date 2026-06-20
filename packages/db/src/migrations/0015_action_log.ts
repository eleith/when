import { sql, type Kysely, type Migration } from 'kysely';

export const actionLog: Migration = {
	async up(db: Kysely<unknown>) {
		await sql`ALTER TABLE appointments ADD COLUMN action_log text`.execute(db);
		await sql`ALTER TABLE appointments DROP COLUMN cancel_reason`.execute(db);
	},
	async down(db: Kysely<unknown>) {
		await sql`ALTER TABLE appointments ADD COLUMN cancel_reason text`.execute(db);
		await sql`ALTER TABLE appointments DROP COLUMN action_log`.execute(db);
	}
};
