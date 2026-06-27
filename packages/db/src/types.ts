import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

export type AppointmentStatus =
	| 'pending'
	| 'confirmed'
	| 'declined'
	| 'cancelled'
	| 'expired'
	| 'rescheduled'
	| 'purged';

export type CalendarHealth = 'good' | 'bad' | 'unknown';

type NullableText = ColumnType<string | null, string | null | undefined, string | null>;

export interface AppointmentsTable {
	id: string;
	event_type_id: string;
	start_time: string;
	end_time: string;
	guest_name: string;
	guest_email: NullableText;
	guest_answers: NullableText;
	guest_timezone: NullableText;
	location: string | null;
	note: string | null;
	conference: string | null;
	status: AppointmentStatus;
	origin_id: NullableText;
	cancel_token: string;
	action_log: NullableText;
	external_event_id: string | null;
	external_calendar_id: string | null;
	calendar_revision: ColumnType<number, number | undefined, number>;
	calendar_synced_revision: ColumnType<number | null, number | null | undefined, number | null>;
	has_possible_conflict: ColumnType<number, number | undefined, number>;
	ics_sequence: ColumnType<number, number | undefined, number>;
	event_type_snapshot: NullableText;
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

export interface ActionLogEntry {
	action:
		| 'create'
		| 'confirm'
		| 'decline'
		| 'cancel'
		| 'reschedule'
		| 'expire'
		| 'email'
		| 'calendar'
		| 'edit';
	actor: 'guest' | 'host' | 'system';
	at: string;
	payload?: {
		note?: string;
		conference?: string;
		field?: string;
		from?: unknown;
		to?: unknown;
		metadata?: Record<string, unknown>;
	};
}

export type JobKind = 'email' | 'calendar';
export type JobState = 'done' | 'failed';
