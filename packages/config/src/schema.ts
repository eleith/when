import { Type, type TSchema, type SchemaOptions, type Static } from '@sinclair/typebox';

// Custom Ref wrapper to avoid deprecation warnings in TypeBox 0.34.0+
const Ref = <T extends TSchema>(schema: T, options?: SchemaOptions) =>
	Type.Unsafe<Static<T>>(Type.Ref(schema.$id!, options));

export const HexColorSchema = Type.String({
	$id: 'HexColor',
	pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$',
	description: 'Hex color code (e.g. #4f46e5 or #fff).'
});

export const OidcAuthSchema = Type.Object({
	issuer: Type.String({ format: 'uri', description: 'OIDC provider issuer URI.' }),
	client_id: Type.String({ minLength: 1, description: 'OIDC client ID.' }),
	client_secret: Type.String({ minLength: 1, description: 'OIDC client secret.' })
}, { $id: 'OidcAuth', additionalProperties: false, title: 'OidcAuth', description: 'OIDC single sign-on authentication configuration.' });

export const CredentialsAuthSchema = Type.Object({
	username: Type.String({ minLength: 1, description: 'Admin username.' }),
	password: Type.String({
		minLength: 1,
		default: '${WHEN_ADMIN_PASSWORD}',
		description: 'Admin password. Defaults to the WHEN_ADMIN_PASSWORD environment variable.'
	})
}, { $id: 'CredentialsAuth', additionalProperties: false, title: 'CredentialsAuth', description: 'Local username/password authentication.' });

export const AuthSchema = Type.Union([
	Type.Object({
		oidc: Ref(OidcAuthSchema, { description: 'OIDC authentication provider configuration.' }),
		credentials: Type.Optional(Type.Null({ description: 'Disabled when OIDC is active.' }))
	}, { additionalProperties: false }),
	Type.Object({
		credentials: Ref(CredentialsAuthSchema, { description: 'Credentials authentication configuration.' }),
		oidc: Type.Optional(Type.Null({ description: 'Disabled when Credentials auth is active.' }))
	}, { additionalProperties: false })
], {
	$id: 'Auth',
	title: 'Auth',
	description: 'Admin authentication strategy. Exactly one of `oidc` or `credentials` must be declared.'
});

export const BrandingSchema = Type.Object({
	logo_url: Type.Optional(Type.String({ minLength: 1, description: 'URL of the logo image. Can be relative (e.g. /public/logo.png).' })),
	color: Type.Object({
		primary: Type.Object({
			light: Ref(HexColorSchema, { default: '#4f46e5', description: 'Primary brand color for light mode.' }),
			dark: Ref(HexColorSchema, { default: '#818cf8', description: 'Primary brand color for dark mode.' })
		}, { additionalProperties: false, default: {}, description: 'Primary brand colors for light and dark modes.' })
	}, { additionalProperties: false, default: {}, required: ['primary'], description: 'Color theme configuration for the booking page.' }),
	avatar_url: Type.Optional(Type.String({ minLength: 1, description: 'URL of the avatar image. Can be relative (e.g. /public/avatar.png).' })),
	favicon_url: Type.Optional(Type.String({ minLength: 1, description: 'URL of the favicon image. Can be relative (e.g. /public/favicon.ico).' })),
	page_title: Type.Optional(Type.String({ minLength: 1, description: 'Title of the booking page (e.g. "Schedule a time with me").' })),
	description: Type.Optional(Type.String({ minLength: 1, description: 'Subtext or introduction shown on the booking page.' }))
}, { $id: 'Branding', additionalProperties: false, title: 'Branding', description: 'Branding options for the booking page and emails. Place custom assets in ./data/public/ to serve them at /public/.' });

export const UserSchema = Type.Object({
	name: Type.String({ minLength: 1, description: 'The display name of the schedule owner.' }),
	timezone: Type.String({
		description: 'IANA timezone identifier (e.g. America/New_York).',
		minLength: 1
	}),
	email: Type.String({ format: 'email', description: 'Email address of the schedule owner.' }),
	branding: Ref(BrandingSchema, { default: {}, description: 'Branding overrides for the schedule owner.' })
}, { $id: 'User', additionalProperties: false, title: 'User', description: 'The schedule owner details.' });

export const SmtpSchema = Type.Object({
	host: Type.String({ minLength: 1, description: 'SMTP server host name.' }),
	port: Type.Integer({ minimum: 1, maximum: 65535, description: 'SMTP server port number (e.g. 587 or 465).' }),
	user: Type.String({ minLength: 1, description: 'SMTP username.' }),
	pass: Type.String({ minLength: 1, description: 'SMTP password.' }),
	from: Type.Optional(Type.String({
		description: 'Email address used as the From on all emails and as the organizer on guest-facing calendar invites, so the host\'s own address is never exposed. Must be an address your SMTP server is allowed to send from. Defaults to noreply@<your url.app domain>. The display name always comes from user.name.',
		minLength: 1
	}))
}, { $id: 'Smtp', additionalProperties: false, title: 'Smtp', description: 'SMTP server used to send appointment emails. Required — the appointment system relies on it.' });

export const CalendarSyncSchema = Type.Object({
	refresh_interval: Type.Optional(Type.Integer({
		description: 'Minutes between the worker\'s busy-time refreshes for this calendar.',
		minimum: 1,
		default: 10
	}))
}, { $id: 'CalendarSync', additionalProperties: false, title: 'CalendarSync', description: 'Per-calendar sync cadence.' });

export const GoogleServiceSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'Unique identifier for the service, referenced by calendars and video chat integrations.' }),
	type: Type.Literal('google', { description: 'Service type: must be google.' }),
	client_id: Type.String({ minLength: 1, description: 'Google OAuth client ID.' }),
	client_secret: Type.String({ minLength: 1, description: 'Google OAuth client secret.' }),
	refresh_token: Type.String({ minLength: 1, description: 'Google OAuth refresh token.' })
}, { $id: 'GoogleService', additionalProperties: false, title: 'GoogleService', description: 'Google API service credentials for calendar and meet integrations.' });

export const NextcloudServiceSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'Unique identifier for the service, referenced by calendars and video chat integrations.' }),
	type: Type.Literal('nextcloud', { description: 'Service type: must be nextcloud.' }),
	url: Type.String({ format: 'uri', description: 'Base URL of your Nextcloud instance (e.g. https://nextcloud.example.com/).' }),
	username: Type.String({ minLength: 1, description: 'Nextcloud username or app username.' }),
	password: Type.String({ minLength: 1, description: 'Nextcloud password or app-specific password.' })
}, { $id: 'NextcloudService', additionalProperties: false, title: 'NextcloudService', description: 'Nextcloud service credentials for CalDAV calendar and Talk video chat integrations.' });

export const CalDavServiceSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'Unique identifier for the service, referenced by calendars.' }),
	type: Type.Literal('caldav', { description: 'Service type: must be caldav.' }),
	url: Type.String({ format: 'uri', description: 'Base URL of your CalDAV endpoint (e.g. https://cloud.example.com/remote.php/dav/).' }),
	username: Type.String({ minLength: 1, description: 'CalDAV username.' }),
	password: Type.String({ minLength: 1, description: 'CalDAV password.' })
}, { $id: 'CalDavService', additionalProperties: false, title: 'CalDavService', description: 'CalDAV service credentials for generic calendar sync.' });

export const ServiceSchema = Type.Union([
	Ref(GoogleServiceSchema),
	Ref(NextcloudServiceSchema),
	Ref(CalDavServiceSchema)
], { $id: 'Service', title: 'Service', description: 'External API service configuration.' });

export const NextcloudTalkVideoChatSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'Unique identifier for this video chat provider.' }),
	type: Type.Literal('nextcloud-talk', { description: 'Video chat provider type: must be nextcloud-talk.' }),
	service_id: Type.String({ minLength: 1, description: 'ID of the nextcloud service to use for video chat creation.' })
}, { $id: 'NextcloudTalkVideoChat', additionalProperties: false, title: 'NextcloudTalkVideoChat', description: 'Nextcloud Talk video conferencing integration.' });

export const GoogleMeetVideoChatSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'Unique identifier for this video chat provider.' }),
	type: Type.Literal('google-meet', { description: 'Video chat provider type: must be google-meet.' }),
	service_id: Type.String({ minLength: 1, description: 'ID of the google service to use for video chat creation.' })
}, { $id: 'GoogleMeetVideoChat', additionalProperties: false, title: 'GoogleMeetVideoChat', description: 'Google Meet video conferencing integration.' });

export const VideoChatSchema = Type.Union([
	Ref(NextcloudTalkVideoChatSchema),
	Ref(GoogleMeetVideoChatSchema)
], { $id: 'VideoChat', title: 'VideoChat', description: 'Video conferencing provider configurations.' });

export const GoogleCalendarSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'Unique identifier for this calendar, referenced by event types.' }),
	type: Type.Literal('google', { description: 'Calendar type: must be google.' }),
	service_id: Type.String({ minLength: 1, description: 'ID of the google service to connect with.' }),
	google_calendar_id: Type.String({ minLength: 1, description: 'The specific Google calendar ID (e.g. primary or an email address).' }),
	sync: Type.Optional(Ref(CalendarSyncSchema, { description: 'Sync settings for this calendar.' }))
}, { $id: 'GoogleCalendar', additionalProperties: false, title: 'GoogleCalendar', description: 'Google Calendar integration configuration.' });

export const CalDavCalendarSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'Unique identifier for this calendar, referenced by event types.' }),
	type: Type.Literal('caldav', { description: 'Calendar type: must be caldav.' }),
	service_id: Type.String({ minLength: 1, description: 'ID of the caldav or nextcloud service to connect with.' }),
	url: Type.String({ format: 'uri', description: 'Full calendar URL endpoint (e.g. https://cloud.example.com/remote.php/dav/calendars/jane/work/).' }),
	sync: Type.Optional(Ref(CalendarSyncSchema, { description: 'Sync settings for this calendar.' }))
}, { $id: 'CalDavCalendar', additionalProperties: false, title: 'CalDavCalendar', description: 'CalDAV Calendar integration configuration.' });

export const CalendarSchema = Type.Union([
	Ref(GoogleCalendarSchema),
	Ref(CalDavCalendarSchema)
], { $id: 'Calendar', title: 'Calendar', description: 'External calendar configuration.' });

export const DayScheduleSchema = Type.Array(
	Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$' }),
	{ $id: 'DaySchedule', title: 'DaySchedule', description: 'Array of HH:MM-HH:MM time ranges in the user\'s timezone.' }
);

export const WeeklyScheduleSchema = Type.Object({
	monday: Type.Optional(Ref(DayScheduleSchema, { description: 'Availability on Mondays.' })),
	tuesday: Type.Optional(Ref(DayScheduleSchema, { description: 'Availability on Tuesdays.' })),
	wednesday: Type.Optional(Ref(DayScheduleSchema, { description: 'Availability on Wednesdays.' })),
	thursday: Type.Optional(Ref(DayScheduleSchema, { description: 'Availability on Thursdays.' })),
	friday: Type.Optional(Ref(DayScheduleSchema, { description: 'Availability on Fridays.' })),
	saturday: Type.Optional(Ref(DayScheduleSchema, { description: 'Availability on Saturdays.' })),
	sunday: Type.Optional(Ref(DayScheduleSchema, { description: 'Availability on Sundays.' }))
}, { $id: 'WeeklySchedule', additionalProperties: false, title: 'WeeklySchedule', description: 'Weekly schedule specifying available time windows for each day.' });

export const AvailabilitySchema = Type.Object({
	slot_granularity: Type.Optional(Type.Integer({ minimum: 1, default: 15, description: 'Time step in minutes; booking slots will snap to this boundary (default: 15).' })),
	minimum_notice: Type.Optional(Type.Integer({ minimum: 0, default: 120, description: 'Minimum lead time required for bookings in minutes (default: 120).' })),
	maximum_lookahead: Type.Optional(Type.Integer({ minimum: 1, default: 60, description: 'Maximum number of days in the future that are open for booking (default: 60).' })),
	buffer_before: Type.Optional(Type.Integer({ minimum: 0, default: 0, description: 'Minutes of buffer time required before each appointment (default: 0).' })),
	buffer_after: Type.Optional(Type.Integer({ minimum: 0, default: 0, description: 'Minutes of buffer time required after each appointment (default: 0).' })),
	max_appointments_per_day: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()], { default: null, description: 'Maximum number of appointments allowed in a single day. null means unlimited (default: null).' })),
	default: Ref(WeeklyScheduleSchema, { description: 'Default weekly working hours.' })
}, { $id: 'Availability', additionalProperties: false, title: 'Availability', description: 'Global availability defaults. Each knob is overridable per event type.' });

export const LocationSchema = Type.String({
	$id: 'Location',
	title: 'Location',
	minLength: 1,
	description: 'A static location description for a meeting (e.g. an address, a phone number, or a static meeting link).'
});

export const FormFieldSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'Unique identifier for the form field.' }),
	type: Type.Union([
		Type.Literal('guest_name'),
		Type.Literal('guest_email'),
		Type.Literal('event_location'),
		Type.Literal('text'),
		Type.Literal('number'),
		Type.Literal('paragraph'),
		Type.Literal('choice')
	], { description: 'Type of form field (e.g. guest_name, guest_email, event_location, text, number, paragraph, choice).' }),
	label: Type.String({ minLength: 1, description: 'The question prompt or label shown to the user.' }),
	required: Type.Boolean({ default: false, description: 'Whether the field must be filled in (default: false).' }),
	choices: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'List of options for the choice field type.' }))
}, { $id: 'FormField', additionalProperties: false, title: 'FormField', description: 'Custom question form fields for bookings.' });

export const EventTypeSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'Unique identifier for the event type.' }),
	name: Type.String({ minLength: 1, description: 'The name of the event type (e.g. 30-minute chat).' }),
	duration: Type.Integer({ minimum: 1, description: 'Duration of the meeting in minutes.' }),
	description: Type.Optional(Type.String({ description: 'Brief description of the meeting.' })),
	slug: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$', description: 'URL slug for the booking page (e.g. "chat" for /schedule/chat).' }),
	visibility: Type.Optional(Type.Union([Type.Literal('public'), Type.Literal('private')], { default: 'public', description: 'Visibility on the homepage. "public" shows it; "private" hides it.' })),
	appointment_flow: Type.Union([Type.Literal('auto'), Type.Literal('requires_confirmation')], { description: 'The approval flow. "auto" confirms instantly; "requires_confirmation" requires host approval.' }),
	conflict_calendars: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { default: [], description: 'Calendar IDs to check for conflicts (busy times) to block slots.' })),
	destination_calendar: Type.String({ minLength: 1, description: 'Calendar ID where confirmed bookings will be written.' }),
	location: Type.Optional(Ref(LocationSchema, { description: 'Static location of the meeting.' })),
	note: Type.Optional(Type.String({ minLength: 1, description: 'A note shown to guests after booking.' })),
	video_chat: Type.Optional(Type.String({ minLength: 1, description: 'ID of the video chat provider to generate dynamic links.' })),
	slot_granularity: Type.Optional(Type.Integer({ minimum: 1, description: 'Override for slot granularity in minutes.' })),
	minimum_notice: Type.Optional(Type.Integer({ minimum: 0, description: 'Override for minimum notice required in minutes.' })),
	maximum_lookahead: Type.Optional(Type.Integer({ minimum: 1, description: 'Override for maximum lookahead in days.' })),
	buffer_before: Type.Optional(Type.Integer({ minimum: 0, description: 'Override for buffer before the meeting in minutes.' })),
	buffer_after: Type.Optional(Type.Integer({ minimum: 0, description: 'Override for buffer after the meeting in minutes.' })),
	max_appointments_per_day: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()], { description: 'Override for maximum appointments per day.' })),
	image_url: Type.Optional(Type.String({ minLength: 1, description: 'URL of an image representing the event type.' })),
	form_fields: Type.Optional(Type.Array(Ref(FormFieldSchema), { description: 'Custom form fields for the booking process.' }))
}, { $id: 'EventType', additionalProperties: false, title: 'EventType', description: 'Definition of a bookable event type.' });

export const DatabaseConfigSchema = Type.Object({
	app: Type.String({
		description: 'Application database (appointments, oauth tokens).',
		minLength: 1,
		default: './data/when.sqlite'
	}),
	queue: Type.String({
		description: 'openworkflow job queue database.',
		minLength: 1,
		default: './data/openworkflow.sqlite'
	})
}, { $id: 'DatabaseConfig', additionalProperties: false, title: 'DatabaseConfig', description: 'On-disk SQLite paths. Relative paths resolve against this config file\'s directory, so web and worker (which load the same config.yaml) open the same files.' });

export const UrlSchema = Type.Object({
	app: Type.String({
		description: 'Public base URL of the app (include the scheme), used to build links in emails and calendar events.',
		minLength: 1,
		default: 'http://localhost:5173'
	}),
	internal: Type.String({
		description: 'Base URL the worker uses to reach the app over the internal network (e.g. http://when-app:3000), used to fetch relative branding images for embedding in emails. Defaults to the WHEN_URL_INTERNAL env var (baked into the Docker images per target); empty falls back to `app`.',
		default: '${WHEN_URL_INTERNAL:-}'
	}),
	worker: Type.String({
		description: 'Base URL the web app uses to reach the worker over the internal network (e.g. http://when-worker:9000), used to query private worker telemetry and metrics.',
		default: 'http://when-worker:9000'
	})
}, { $id: 'Url', additionalProperties: false, title: 'Url', description: 'Public URLs for the app.' });

export const PrometheusConfigSchema = Type.Object({
	enabled: Type.Boolean({ description: 'Whether metrics collection and endpoint are active.', default: false }),
	secret: Type.String({ description: 'Bearer token for scraping metrics. Defaults to METRICS_TOKEN env var.', default: '${METRICS_TOKEN:-}' })
}, { $id: 'PrometheusConfig', additionalProperties: false, title: 'PrometheusConfig', description: 'Prometheus metrics collection settings.' });

export const WhenConfigurationSchema = Type.Object({
	auth: Ref(AuthSchema, { description: 'Admin authentication configuration.' }),
	user: Ref(UserSchema, { description: 'Details about the schedule owner.' }),
	smtp: Ref(SmtpSchema, { description: 'SMTP email server settings.' }),
	services: Type.Optional(Type.Array(Ref(ServiceSchema), { default: [], description: 'Credentials for third-party services.' })),
	video_chats: Type.Optional(Type.Array(Ref(VideoChatSchema), { default: [], description: 'Video conferencing provider settings.' })),
	calendars: Type.Array(Ref(CalendarSchema), { description: 'Connected conflict/destination calendars.' }),
	availability: Ref(AvailabilitySchema, { description: 'Global scheduling rules and weekly hours.' }),
	event_types: Type.Array(Ref(EventTypeSchema), { minItems: 1, description: 'Bookable meeting types.' }),
	database: Ref(DatabaseConfigSchema, { default: {}, description: 'Local SQLite database file paths.' }),
	url: Ref(UrlSchema, { default: {}, description: 'Server and client URL configuration.' }),
	prometheus: Ref(PrometheusConfigSchema, { default: {}, description: 'Prometheus metrics settings.' })
}, {
	additionalProperties: false,
	title: 'When configuration',
	description: 'Canonical schema for the When self-hosted scheduling app\'s config.yaml.'
});

export type WhenConfiguration = Static<typeof WhenConfigurationSchema>;
export type Auth = Static<typeof AuthSchema>;
export type User = Static<typeof UserSchema>;
export type Branding = Static<typeof BrandingSchema>;
export type Smtp = Static<typeof SmtpSchema>;
export type Service = Static<typeof ServiceSchema>;
export type GoogleService = Static<typeof GoogleServiceSchema>;
export type NextcloudService = Static<typeof NextcloudServiceSchema>;
export type CalDavService = Static<typeof CalDavServiceSchema>;
export type VideoChat = Static<typeof VideoChatSchema>;
export type NextcloudTalkVideoChat = Static<typeof NextcloudTalkVideoChatSchema>;
export type GoogleMeetVideoChat = Static<typeof GoogleMeetVideoChatSchema>;
export type Calendar = Static<typeof CalendarSchema>;
export type GoogleCalendar = Static<typeof GoogleCalendarSchema>;
export type CalendarSync = Static<typeof CalendarSyncSchema>;
export type CalDavCalendar = Static<typeof CalDavCalendarSchema>;
export type Availability = Static<typeof AvailabilitySchema>;
export type WeeklySchedule = Static<typeof WeeklyScheduleSchema>;
export type DaySchedule = Static<typeof DayScheduleSchema>;
export type EventType = Static<typeof EventTypeSchema>;
export type FormField = Static<typeof FormFieldSchema>;
export type Location = Static<typeof LocationSchema>;
export type PrometheusConfig = Static<typeof PrometheusConfigSchema>;
export type DatabaseConfig = Static<typeof DatabaseConfigSchema>;
export type Url = Static<typeof UrlSchema>;
