import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

export type AppointmentStatus =
	| 'pending'
	| 'confirmed'
	| 'declined'
	| 'cancelled'
	| 'expired'
	| 'rescheduled'
	| 'purged';

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
	video_chat: string | null;
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
	meeting_snapshot: NullableText;
	created_at: ColumnType<string, string | undefined, string>;
	updated_at: ColumnType<string, string | undefined, string>;
}

export interface OauthTokensTable {
	provider_name: string;
	refresh_token: string;
	connected_at: ColumnType<string, string | undefined, string>;
	updated_at: ColumnType<string, string | undefined, string>;
}

export interface ExternalCalendarBusyTable {
	id: Generated<number>;
	calendar_id: string;
	start_time: string;
	end_time: string;
}

export interface ServiceStatusTable {
	kind: string;
	name: string;
	last_attempt_at: NullableText;
	last_ok_at: NullableText;
	failing_since: NullableText;
	error: NullableText;
	via: NullableText;
}

export interface Database {
	appointments: AppointmentsTable;
	oauth_tokens: OauthTokensTable;
	external_calendar_busy: ExternalCalendarBusyTable;
	service_status: ServiceStatusTable;
}

export type Appointment = Selectable<AppointmentsTable>;
export type NewAppointment = Insertable<AppointmentsTable>;
export type AppointmentUpdate = Updateable<AppointmentsTable>;

export type ExternalCalendarBusy = Selectable<ExternalCalendarBusyTable>;
export type NewExternalCalendarBusy = Insertable<ExternalCalendarBusyTable>;

export type ServiceStatus = Selectable<ServiceStatusTable>;

export type OauthToken = Selectable<OauthTokensTable>;
export type NewOauthToken = Insertable<OauthTokensTable>;
export type OauthTokenUpdate = Updateable<OauthTokensTable>;

export interface ActionLogEntry {
	action:
		| 'create'
		| 'confirm'
		| 'decline'
		| 'cancel'
		| 'reschedule'
		| 'rotate'
		| 'expire'
		| 'email'
		| 'calendar'
		| 'video_chat'
		| 'edit';
	actor: 'guest' | 'host' | 'system';
	at: string;
	payload?: {
		note?: string;
		video_chat?: string;
		field?: string;
		from?: unknown;
		to?: unknown;
		metadata?: Record<string, unknown>;
	};
}

export type JobKind = 'email' | 'calendar' | 'video_chat';
export type JobState = 'done' | 'failed';
