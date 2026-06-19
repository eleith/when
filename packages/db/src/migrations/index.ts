import type { Migration } from 'kysely';
import { initial } from './0001_initial.js';
import { responseToken } from './0002_response_token.js';
import { icsSequence } from './0003_ics_sequence.js';
import { dropResponseToken } from './0004_drop_response_token.js';
import { notificationStatusColumns } from './0005_notification_status_columns.js';
import { calendarMirrorTables } from './0006_calendar_mirror_tables.js';
import { appointmentCalendarColumns } from './0007_appointment_calendar_columns.js';
import { attendeeTimezone } from './0008_attendee_timezone.js';
import { rescheduleOrigin } from './0009_reschedule_origin.js';
import { rescheduleChain } from './0010_reschedule_chain.js';
import { originIdIndex } from './0011_origin_id_index.js';
import { formCustomization } from './0012_form_customization.js';
import { eventTypeSnapshot } from './0013_event_type_snapshot.js';
import { cancelReason } from './0014_cancel_reason.js';

// Registered in order; keys are the migration names Kysely's Migrator records.
export const migrations: Record<string, Migration> = {
	'0001_initial': initial,
	'0002_response_token': responseToken,
	'0003_ics_sequence': icsSequence,
	'0004_drop_response_token': dropResponseToken,
	'0005_notification_status_columns': notificationStatusColumns,
	'0006_calendar_mirror_tables': calendarMirrorTables,
	'0007_appointment_calendar_columns': appointmentCalendarColumns,
	'0008_attendee_timezone': attendeeTimezone,
	'0009_reschedule_origin': rescheduleOrigin,
	'0010_reschedule_chain': rescheduleChain,
	'0011_origin_id_index': originIdIndex,
	'0012_form_customization': formCustomization,
	'0013_event_type_snapshot': eventTypeSnapshot,
	'0014_cancel_reason': cancelReason
};
