import { sql, type Kysely, type Migration } from 'kysely';

const initial: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.createTable('appointments')
			.addColumn('id', 'text', (c) => c.primaryKey())
			.addColumn('event_type_id', 'text', (c) => c.notNull())
			.addColumn('start_time', 'text', (c) => c.notNull())
			.addColumn('end_time', 'text', (c) => c.notNull())
			.addColumn('attendee_name', 'text', (c) => c.notNull())
			.addColumn('attendee_email', 'text', (c) => c.notNull())
			.addColumn('attendee_notes', 'text')
			.addColumn('location', 'text')
			.addColumn('status', 'text', (c) => c.notNull())
			.addColumn('cancel_token', 'text', (c) => c.notNull().unique())
			.addColumn('external_event_id', 'text')
			.addColumn('external_calendar_id', 'text')
			.addColumn('notification_status', 'text')
			.addColumn('created_at', 'text', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
			.addColumn('updated_at', 'text', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
			.execute();

		await sql`
			CREATE UNIQUE INDEX active_slot
				ON appointments(event_type_id, start_time)
				WHERE status IN ('pending','confirmed')
		`.execute(db);

		await db.schema
			.createIndex('appointments_start_time')
			.on('appointments')
			.column('start_time')
			.execute();

		await db.schema
			.createIndex('appointments_status')
			.on('appointments')
			.column('status')
			.execute();

		await db.schema
			.createTable('oauth_tokens')
			.addColumn('calendar_id', 'text', (c) => c.primaryKey())
			.addColumn('access_token', 'text', (c) => c.notNull())
			.addColumn('refresh_token', 'text', (c) => c.notNull())
			.addColumn('expires_at', 'text', (c) => c.notNull())
			.addColumn('updated_at', 'text', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
			.execute();
	},

	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.dropTable('oauth_tokens').execute();
		await db.schema.dropTable('appointments').execute();
	}
};

const responseToken: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').addColumn('response_token', 'text').execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').dropColumn('response_token').execute();
	}
};

const icsSequence: Migration = {
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

// Organizer accept/decline moved from one-click token links to the login-gated
// /booked/[id] detail page, so the per-booking response_token is no longer used.
const dropResponseToken: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').dropColumn('response_token').execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').addColumn('response_token', 'text').execute();
	}
};

export const migrations: Record<string, Migration> = {
	'0001_initial': initial,
	'0002_response_token': responseToken,
	'0003_ics_sequence': icsSequence,
	'0004_drop_response_token': dropResponseToken
};
