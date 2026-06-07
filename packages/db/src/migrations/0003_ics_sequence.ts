import type { Kysely, Migration } from 'kysely';

export const icsSequence: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.alterTable('appointments')
			.addColumn('ics_sequence', 'integer', (c) => c.notNull().defaultTo(0))
			.execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').dropColumn('ics_sequence').execute();
	}
};
