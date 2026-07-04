import { sql, type Kysely, type Migration } from 'kysely';

export const renameConferenceToVideoChat: Migration = {
	async up(db: Kysely<unknown>) {
		await sql`ALTER TABLE appointments RENAME COLUMN conference TO video_chat`.execute(db);
	},
	async down(db: Kysely<unknown>) {
		await sql`ALTER TABLE appointments RENAME COLUMN video_chat TO conference`.execute(db);
	}
};
