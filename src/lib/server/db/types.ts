import type { ColumnType, Insertable, Selectable, Updateable } from 'kysely';

export type AppointmentStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled';

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
	response_token: string | null;
	external_event_id: string | null;
	external_calendar_id: string | null;
	notification_status: string | null;
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

export interface AvailabilityOverridesTable {
	id: string;
	/** ISO date YYYY-MM-DD in user_tz. */
	date: string;
	/** HH:MM in user_tz; null means the day is fully blocked. */
	start_time: string | null;
	end_time: string | null;
	reason: string | null;
	created_at: ColumnType<string, string | undefined, string>;
}

export interface Database {
	appointments: AppointmentsTable;
	oauth_tokens: OauthTokensTable;
	availability_overrides: AvailabilityOverridesTable;
}

export type Appointment = Selectable<AppointmentsTable>;
export type NewAppointment = Insertable<AppointmentsTable>;
export type AppointmentUpdate = Updateable<AppointmentsTable>;
export type AvailabilityOverride = Selectable<AvailabilityOverridesTable>;
export type NewAvailabilityOverride = Insertable<AvailabilityOverridesTable>;
