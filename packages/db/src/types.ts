import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

export type AppointmentStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled';

export type CalendarHealth = 'good' | 'bad' | 'unknown';

type NullableText = ColumnType<string | null, string | null | undefined, string | null>;

export type NotificationOutcome = 'queued' | 'ok' | 'failed';
export type NotificationChannel = 'email' | 'calendar_push';

type NotificationColumn = ColumnType<
	NotificationOutcome | null,
	NotificationOutcome | null | undefined,
	NotificationOutcome | null
>;

export interface AppointmentsTable {
	id: string;
	event_type_id: string;
	start_time: string;
	end_time: string;
	attendee_name: string;
	attendee_email: string;
	attendee_notes: string | null;
	location: string | null;
	status: AppointmentStatus;
	cancel_token: string;
	external_event_id: string | null;
	external_calendar_id: string | null;
	email_notification_status: NotificationColumn;
	calendar_push_notification_status: NotificationColumn;
	calendar_revision: ColumnType<number, number | undefined, number>;
	calendar_synced_revision: ColumnType<number | null, number | null | undefined, number | null>;
	has_possible_conflict: ColumnType<number, number | undefined, number>;
	calendar_push_failing_since: NullableText;
	ics_sequence: ColumnType<number, number | undefined, number>;
	created_at: ColumnType<string, string | undefined, string>;
	updated_at: ColumnType<string, string | undefined, string>;
}

export interface OauthTokensTable {
	calendar_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: string;
	updated_at: ColumnType<string, string | undefined, string>;
}

export interface ExternalCalendarBusyTable {
	id: Generated<number>;
	calendar_id: string;
	start_time: string;
	end_time: string;
}

export interface CalendarSyncStatusTable {
	calendar_id: string;
	last_refresh_at: NullableText;
	last_successful_refresh_at: NullableText;
	error: NullableText;
	health: ColumnType<CalendarHealth, CalendarHealth | undefined, CalendarHealth>;
	health_changed_at: NullableText;
	health_reason: NullableText;
}

export interface Database {
	appointments: AppointmentsTable;
	oauth_tokens: OauthTokensTable;
	external_calendar_busy: ExternalCalendarBusyTable;
	calendar_sync_status: CalendarSyncStatusTable;
}

export type Appointment = Selectable<AppointmentsTable>;
export type NewAppointment = Insertable<AppointmentsTable>;
export type AppointmentUpdate = Updateable<AppointmentsTable>;

export type ExternalCalendarBusy = Selectable<ExternalCalendarBusyTable>;
export type NewExternalCalendarBusy = Insertable<ExternalCalendarBusyTable>;

export type CalendarSyncStatus = Selectable<CalendarSyncStatusTable>;
export type NewCalendarSyncStatus = Insertable<CalendarSyncStatusTable>;
export type CalendarSyncStatusUpdate = Updateable<CalendarSyncStatusTable>;
