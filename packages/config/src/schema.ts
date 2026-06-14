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
export type HexColor = string;
export type Calendar = GoogleCalendar | CalDavCalendar;
/**
 * Array of HH:MM-HH:MM time ranges in the user's timezone.
 */
export type DaySchedule = string[];
export type Location = LocationFixed | LocationGuestProposes | LocationChoice;

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
  branding?: Branding;
}
export interface Branding {
  logo_url?: string;
  /**
   * Primary brand color. A muted tonal scale is derived from it. Either a single hex string used in both modes, or an object with `light` and `dark` hex values.
   */
  primary_color?:
    | HexColor
    | {
        light: HexColor;
        dark: HexColor;
      };
  avatar_url?: string;
  favicon_url?: string;
  page_title?: string;
  description?: string;
}
/**
 * SMTP server used to send booking emails. Required — the booking system relies on it.
 */
export interface Smtp {
  host: string;
  port: number;
  user: string;
  pass: string;
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
 * Global availability defaults. Each setting is overridable per event type.
 */
export interface Availability {
  slot_granularity?: number;
  minimum_notice?: number;
  maximum_lookahead?: number;
  buffer_before?: number;
  buffer_after?: number;
  max_bookings_per_day?: number | null;
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
  booking_flow: "auto" | "requires_confirmation";
  conflict_calendars?: string[];
  destination_calendar: string;
  location?: Location;
  slot_granularity?: number;
  minimum_notice?: number;
  maximum_lookahead?: number;
  buffer_before?: number;
  buffer_after?: number;
  max_bookings_per_day?: number | null;
  image_url?: string;
}
export interface LocationFixed {
  mode: "fixed";
  fixed: string;
}
export interface LocationGuestProposes {
  mode: "guest_proposes";
}
export interface LocationChoice {
  mode: "choice";
  /**
   * @minItems 1
   */
  choices: [string, ...string[]];
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
