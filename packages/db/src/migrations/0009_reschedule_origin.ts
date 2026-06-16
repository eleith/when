import { sql, type Kysely, type Migration } from 'kysely';

export const rescheduleOrigin: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').addColumn('origin_id', 'text').execute();
		await sql`UPDATE appointments SET origin_id = id WHERE origin_id IS NULL`.execute(db);
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').dropColumn('origin_id').execute();
	}
};
