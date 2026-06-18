import { sql, type Kysely, type Migration } from 'kysely';

const COPIED_COLUMNS = [
	'id',
	'event_type_id',
	'start_time',
	'end_time',
	'attendee_name',
	'attendee_email',
	'attendee_timezone',
	'location',
	'status',
	'origin_id',
	'rescheduled_from_id',
	'rescheduled_to_id',
	'cancel_token',
	'external_event_id',
	'external_calendar_id',
	'email_notification_status',
	'calendar_push_notification_status',
	'calendar_revision',
	'calendar_synced_revision',
	'has_possible_conflict',
	'calendar_push_failing_since',
	'ics_sequence',
	'created_at',
	'updated_at'
];

function createAppointments(db: Kysely<unknown>, variant: 'new' | 'old') {
	let table = db.schema
		.createTable('appointments')
		.addColumn('id', 'text', (c) => c.primaryKey())
		.addColumn('event_type_id', 'text', (c) => c.notNull())
		.addColumn('start_time', 'text', (c) => c.notNull())
		.addColumn('end_time', 'text', (c) => c.notNull())
		.addColumn('attendee_name', 'text', (c) => c.notNull())
		.addColumn('attendee_email', 'text', (c) => (variant === 'old' ? c.notNull() : c));

	table =
		variant === 'new'
			? table.addColumn('attendee_answers', 'text')
			: table.addColumn('attendee_notes', 'text');

	return table
		.addColumn('attendee_timezone', 'text')
		.addColumn('location', 'text')
		.addColumn('status', 'text', (c) => c.notNull())
		.addColumn('origin_id', 'text')
		.addColumn('rescheduled_from_id', 'text')
		.addColumn('rescheduled_to_id', 'text')
		.addColumn('cancel_token', 'text', (c) => c.notNull().unique())
		.addColumn('external_event_id', 'text')
		.addColumn('external_calendar_id', 'text')
		.addColumn('email_notification_status', 'text')
		.addColumn('calendar_push_notification_status', 'text')
		.addColumn('calendar_revision', 'integer', (c) => c.notNull().defaultTo(0))
		.addColumn('calendar_synced_revision', 'integer')
		.addColumn('has_possible_conflict', 'integer', (c) => c.notNull().defaultTo(0))
		.addColumn('calendar_push_failing_since', 'text')
		.addColumn('ics_sequence', 'integer', (c) => c.notNull().defaultTo(0))
		.addColumn('created_at', 'text', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
		.addColumn('updated_at', 'text', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`));
}

async function recreateIndexes(db: Kysely<unknown>): Promise<void> {
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
	await db.schema.createIndex('appointments_status').on('appointments').column('status').execute();
	await db.schema
		.createIndex('appointments_origin_id')
		.on('appointments')
		.column('origin_id')
		.execute();
}

async function rebuild(db: Kysely<unknown>, variant: 'new' | 'old'): Promise<void> {
	await sql`ALTER TABLE appointments RENAME TO _appointments_old`.execute(db);
	await createAppointments(db, variant).execute();
	const cols = sql.raw(COPIED_COLUMNS.join(', '));
	await sql`INSERT INTO appointments (${cols}) SELECT ${cols} FROM _appointments_old`.execute(db);
	await sql`DROP TABLE _appointments_old`.execute(db);
	await recreateIndexes(db);
}

export const formCustomization: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await rebuild(db, 'new');
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await rebuild(db, 'old');
	}
};
