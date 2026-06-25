/**
 * Admin auth strategy. Exactly one of `oidc` or `credentials` must be declared.
 */
export type Auth =
  | {
      oidc: OidcAuth;
    }
  | {
      credentials: CredentialsAuth;
    };
export type Calendar = GoogleCalendar | CalDavCalendar;
/**
 * Array of HH:MM-HH:MM time ranges in the user's timezone.
 */
export type DaySchedule = string[];
export type Location = LocationFixed;

/**
 * Canonical schema for the When self-hosted scheduling app's config.yaml.
 */
export interface WhenConfiguration {
  auth: Auth;
  user: User;
  smtp: Smtp;
  calendars: Calendar[];
  availability: Availability;
  /**
   * @minItems 1
   */
  event_types: [EventType, ...EventType[]];
  database: DatabaseConfig;
  url: Url;
}
export interface OidcAuth {
  issuer: string;
  client_id: string;
  client_secret: string;
}
/**
 * Local username/password. `password_hash` is an argon2/bcrypt hash (generate with `pnpm hash-password`).
 */
export interface CredentialsAuth {
  username: string;
  password_hash: string;
}
export interface User {
  name: string;
  /**
   * IANA timezone identifier (e.g. America/New_York).
   */
  timezone: string;
  email: string;
  branding: Branding;
}
export interface Branding {
  logo_url?: string;
  color: {
    primary: {
      light: string;
      dark: string;
    };
  };
  avatar_url?: string;
  favicon_url?: string;
  page_title?: string;
  description?: string;
}
/**
 * SMTP server used to send appointment emails. Required — the appointment system relies on it.
 */
export interface Smtp {
  host: string;
  port: number;
  user: string;
  pass: string;
  /**
   * Email address used as the From on all emails and as the organizer on guest-facing calendar invites, so the host's own address is never exposed. Must be an address your SMTP server is allowed to send from. Defaults to noreply@<your url.app domain>. The display name always comes from user.name.
   */
  from?: string;
}
export interface GoogleCalendar {
  id: string;
  type: "google";
  client_id: string;
  client_secret: string;
  refresh_token: string;
  google_calendar_id: string;
  sync?: CalendarSync;
}
/**
 * Per-calendar sync cadence.
 */
export interface CalendarSync {
  /**
   * Minutes between the worker's busy-time refreshes for this calendar.
   */
  refresh_interval?: number;
}
export interface CalDavCalendar {
  id: string;
  type: "caldav";
  url: string;
  username: string;
  password: string;
  sync?: CalendarSync;
}
/**
 * Global availability defaults. Each knob is overridable per event type.
 */
export interface Availability {
  slot_granularity?: number;
  minimum_notice?: number;
  maximum_lookahead?: number;
  buffer_before?: number;
  buffer_after?: number;
  max_appointments_per_day?: number | null;
  default: WeeklySchedule;
}
export interface WeeklySchedule {
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
  sunday?: DaySchedule;
}
export interface EventType {
  id: string;
  name: string;
  duration: number;
  description?: string;
  slug: string;
  visibility?: "public" | "private";
  appointment_flow: "auto" | "requires_confirmation";
  conflict_calendars?: string[];
  destination_calendar: string;
  location?: Location;
  note?: string;
  slot_granularity?: number;
  minimum_notice?: number;
  maximum_lookahead?: number;
  buffer_before?: number;
  buffer_after?: number;
  max_appointments_per_day?: number | null;
  image_url?: string;
  form_fields?: FormField[];
}
export interface LocationFixed {
  mode: "fixed";
  fixed: string;
}
export interface FormField {
  id: string;
  type: "guest_name" | "guest_email" | "event_location" | "text" | "number" | "paragraph" | "choice";
  label: string;
  required: boolean;
  choices?: string[];
}
/**
 * On-disk SQLite paths. Relative paths resolve against this config file's directory, so web and worker (which load the same config.yaml) open the same files.
 */
export interface DatabaseConfig {
  /**
   * Application database (appointments, oauth tokens).
   */
  app: string;
  /**
   * openworkflow job queue database.
   */
  queue: string;
}
/**
 * Public URLs for the app.
 */
export interface Url {
  /**
   * Public base URL of the app (include the scheme), used to build links in emails and calendar events.
   */
  app: string;
  /**
   * Base URL the worker uses to reach the app over the internal network (e.g. http://when-app:3000), used to fetch relative branding images for embedding in emails. Defaults to the WHEN_URL_INTERNAL env var (baked into the Docker images per target); empty falls back to `app`.
   */
  internal: string;
}
