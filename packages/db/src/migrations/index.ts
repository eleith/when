import type { Migration } from 'kysely';
import { initial } from './0001_initial.js';
import { responseToken } from './0002_response_token.js';
import { icsSequence } from './0003_ics_sequence.js';
import { dropResponseToken } from './0004_drop_response_token.js';
import { notificationStatusColumns } from './0005_notification_status_columns.js';

// Registered in order; keys are the migration names Kysely's Migrator records.
export const migrations: Record<string, Migration> = {
	'0001_initial': initial,
	'0002_response_token': responseToken,
	'0003_ics_sequence': icsSequence,
	'0004_drop_response_token': dropResponseToken,
	'0005_notification_status_columns': notificationStatusColumns
};
