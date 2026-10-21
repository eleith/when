import { sql, type Kysely, type Migration } from 'kysely';

export const videoChatRequest: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await sql`
			ALTER TABLE appointments ADD COLUMN video_chat_request text
				DEFAULT NULL
				CHECK (video_chat_request IS NULL OR video_chat_request IN ('generate', 'suppress'))
		`.execute(db);
	},

	async down(db: Kysely<unknown>): Promise<void> {
		await sql`ALTER TABLE appointments DROP COLUMN video_chat_request`.execute(db);
	}
};
