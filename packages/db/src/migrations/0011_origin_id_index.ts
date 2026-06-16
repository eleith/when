import type { Kysely, Migration } from 'kysely';

export const originIdIndex: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.createIndex('appointments_origin_id')
			.on('appointments')
			.column('origin_id')
			.execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.dropIndex('appointments_origin_id').execute();
	}
};
