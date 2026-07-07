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
import { actionLog } from './0015_action_log.js';
import { dropRescheduleChainColumns } from './0016_drop_reschedule_chain_columns.js';
import { dropNotificationColumns } from './0017_drop_notification_columns.js';
import { renameAttendeeToGuest } from './0018_rename_attendee_to_guest.js';
import { addAppointmentNote } from './0019_add_appointment_note.js';
import { addAppointmentConference } from './0020_add_appointment_conference.js';
import { dropCalendarHealthColumns } from './0021_drop_calendar_health_columns.js';
import { renameConferenceToVideoChat } from './0022_rename_conference_to_video_chat.js';
import { renameEventTypeSnapshotToMeetingSnapshot } from './0023_rename_event_type_snapshot_to_meeting_snapshot.js';

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
	'0014_cancel_reason': cancelReason,
	'0015_action_log': actionLog,
	'0016_drop_reschedule_chain_columns': dropRescheduleChainColumns,
	'0017_drop_notification_columns': dropNotificationColumns,
	'0018_rename_attendee_to_guest': renameAttendeeToGuest,
	'0019_add_appointment_note': addAppointmentNote,
	'0020_add_appointment_conference': addAppointmentConference,
	'0021_drop_calendar_health_columns': dropCalendarHealthColumns,
	'0022_rename_conference_to_video_chat': renameConferenceToVideoChat,
	'0023_rename_event_type_snapshot_to_meeting_snapshot': renameEventTypeSnapshotToMeetingSnapshot
};
