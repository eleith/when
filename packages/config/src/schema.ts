import { Type, type TSchema, type SchemaOptions, type Static } from '@sinclair/typebox';

// Custom Ref wrapper to avoid deprecation warnings in TypeBox 0.34.0+
const Ref = <T extends TSchema>(schema: T, options?: SchemaOptions) =>
	Type.Unsafe<Static<T>>(Type.Ref(schema.$id!, options));

export const HexColorSchema = Type.String({
	$id: 'HexColor',
	pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$',
	description: 'Hex color code (e.g. #4f46e5 or #fff).'
});

export const LocalPathSchema = Type.String({
	$id: 'LocalPath',
	pattern: '^/[^/\\\\]',
	description:
		'Root-relative path to an asset this app serves (e.g. /public/icon.png). Remote URLs are not accepted — put the file in ./public/ and reference it at /public/.'
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
	}, { additionalProperties: false, title: 'Single sign-on (oidc)' }),
	Type.Object({
		credentials: Ref(CredentialsAuthSchema, { description: 'Credentials authentication configuration.' }),
		oidc: Type.Optional(Type.Null({ description: 'Disabled when Credentials auth is active.' }))
	}, { additionalProperties: false, title: 'Username and password (credentials)' })
], {
	$id: 'Auth',
	title: 'Auth',
	description: 'Admin authentication strategy. Exactly one of `oidc` or `credentials` must be declared.'
});

export const AppearanceSchema = Type.Object({
	title: Type.String({ default: 'if not now, when?', description: 'Title of the booking page.' }),
	description: Type.String({ default: 'find some time and we can meet', description: 'Subtext or introduction shown on the booking page.' }),
	app_icon_path: Ref(LocalPathSchema, { default: '/assets/images/app-icon.svg', description: 'Path to the app icon (default: the bundled /assets/images/app-icon.svg, a calendar).' }),
	avatar_path: Ref(LocalPathSchema, { default: '/assets/images/avatar.svg', description: 'Path to the avatar image (default: /assets/images/avatar.svg, generated from the owner\'s name).' }),
	favicon_path: Ref(LocalPathSchema, { default: '/assets/images/favicon.svg', description: 'Path to the favicon image (default: the bundled /assets/images/favicon.svg).' }),
	opengraph_path: Ref(LocalPathSchema, { default: '/assets/images/opengraph.png', description: 'Path to the share (opengraph) image (default: /assets/images/opengraph.png, generated from the appearance).' }),
	font_name: Type.String({ minLength: 1, default: 'Noto Sans', description: 'Font family for the booking page and share card: one of the bundled families (Noto Sans, Lato, Outfit, Inter) or the family name of a custom `font_path` font.' }),
	font_path: Type.Optional(Ref(LocalPathSchema, { description: 'Path to the custom font file (woff2), registered as `font_name`.' })),
	primary_light_color: Ref(HexColorSchema, { default: '#166534', description: 'Primary brand color for light mode.' }),
	primary_dark_color: Ref(HexColorSchema, { default: '#34d399', description: 'Primary brand color for dark mode.' }),
	background_light_color: Ref(HexColorSchema, { default: '#f5f5f5', description: 'Background color for light mode.' }),
	background_dark_color: Ref(HexColorSchema, { default: '#0a0a0a', description: 'Background color for dark mode.' }),
	text_light_color: Ref(HexColorSchema, { default: '#171717', description: 'Text color for light mode.' }),
	text_dark_color: Ref(HexColorSchema, { default: '#ededed', description: 'Text color for dark mode.' })
}, { $id: 'Appearance', additionalProperties: false, title: 'Appearance', description: 'Appearance and theme options for the booking page and emails. Place custom assets in ./public/ to serve them at /public/.' });

export const UserSchema = Type.Object({
	name: Type.String({ minLength: 1, description: 'The display name of the schedule owner.' }),
	timezone: Type.String({
		description:
			'IANA timezone identifier (e.g. America/New_York). Defaults to the TZ environment variable, or UTC when unset.',
		minLength: 1,
		default: '${TZ:-UTC}'
	}),
	email: Type.String({ format: 'email', description: 'Email address of the schedule owner.' }),
	appearance: Ref(AppearanceSchema, { default: {}, description: 'Appearance overrides for the schedule owner.' })
}, { $id: 'User', additionalProperties: false, title: 'User', description: 'The schedule owner details.' });

export const SmtpSchema = Type.Object({
	host: Type.String({ minLength: 1, description: 'SMTP server host name.' }),
	port: Type.Integer({ minimum: 1, maximum: 65535, default: 587, description: 'SMTP server port number (default: 587; e.g. 587 or 465).' }),
	username: Type.String({ minLength: 1, description: 'SMTP username.' }),
	password: Type.String({ minLength: 1, description: 'SMTP password.' }),
	from: Type.Optional(Type.String({
		description: 'Email address used as the From on all emails and as the organizer on guest-facing calendar invites, so the host\'s own address is never exposed. Must be an address your SMTP server is allowed to send from. Defaults to noreply@<your url.app domain>. The display name always comes from user.name.',
		minLength: 1
	}))
}, { $id: 'Smtp', additionalProperties: false, title: 'Smtp', description: 'SMTP server used to send appointment emails. Required — the appointment system relies on it.' });

export const CalendarSyncSchema = Type.Object({
	refresh_every_minutes: Type.Integer({
		description: 'Minutes between the worker\'s busy-time refreshes for this calendar.',
		minimum: 1,
		default: 10
	})
}, { $id: 'CalendarSync', additionalProperties: false, title: 'CalendarSync', description: 'Per-calendar sync cadence.' });

export const GoogleCalendarSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'The specific Google calendar ID (e.g. primary or an email address).' }),
	sync: Ref(CalendarSyncSchema, { default: {}, description: 'Sync settings for this calendar.' })
}, { $id: 'GoogleCalendar', additionalProperties: false, title: 'GoogleCalendar', description: 'A calendar on a Google provider.' });

export const CalDavCalendarSchema = Type.Object({
	href: Type.String({ minLength: 1, pattern: '^(https?://[^\\s]+|(?!//)(?![a-zA-Z][a-zA-Z0-9+.-]*:)[^\\s]+)$', description: 'Where the calendar lives: a path joined to the provider url, or a full http(s) URL of its own.' }),
	sync: Ref(CalendarSyncSchema, { default: {}, description: 'Sync settings for this calendar.' })
}, { $id: 'CalDavCalendar', additionalProperties: false, title: 'CalDavCalendar', description: 'A calendar on a CalDAV or Nextcloud provider.' });

export const GoogleProviderSchema = Type.Object({
	type: Type.Literal('google', { description: 'Provider type: must be google.' }),
	client_id: Type.String({ minLength: 1, description: 'Google OAuth client ID.' }),
	client_secret: Type.String({ minLength: 1, description: 'Google OAuth client secret.' }),
	calendars: Type.Record(Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }), Ref(GoogleCalendarSchema, { default: {} }), { additionalProperties: false, default: {}, description: 'Calendars served by this provider, keyed by the name meetings reference.' })
}, { $id: 'GoogleProvider', additionalProperties: false, title: 'GoogleProvider', description: 'Google API provider credentials. The refresh token is not configured here — connect the provider from the admin and it is stored in the database.' });

export const NextcloudProviderSchema = Type.Object({
	type: Type.Literal('nextcloud', { description: 'Provider type: must be nextcloud.' }),
	url: Type.String({ format: 'uri', description: 'Base URL of your Nextcloud instance (e.g. https://nextcloud.example.com/).' }),
	username: Type.String({ minLength: 1, description: 'Nextcloud username or app username.' }),
	password: Type.String({ minLength: 1, description: 'Nextcloud password or app-specific password.' }),
	calendars: Type.Record(Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }), Ref(CalDavCalendarSchema, { default: {} }), { additionalProperties: false, default: {}, description: 'Calendars served by this provider, keyed by the name meetings reference.' })
}, { $id: 'NextcloudProvider', additionalProperties: false, title: 'NextcloudProvider', description: 'Nextcloud provider credentials for CalDAV calendar and Talk video chat integrations.' });

export const CalDavProviderSchema = Type.Object({
	type: Type.Literal('caldav', { description: 'Provider type: must be caldav.' }),
	url: Type.String({ format: 'uri', description: 'Base URL of your CalDAV endpoint (e.g. https://cloud.example.com/remote.php/dav/).' }),
	username: Type.String({ minLength: 1, description: 'CalDAV username.' }),
	password: Type.String({ minLength: 1, description: 'CalDAV password.' }),
	calendars: Type.Record(Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }), Ref(CalDavCalendarSchema, { default: {} }), { additionalProperties: false, default: {}, description: 'Calendars served by this provider, keyed by the name meetings reference.' })
}, { $id: 'CalDavProvider', additionalProperties: false, title: 'CalDavProvider', description: 'CalDAV provider credentials for generic calendar sync.' });

export const ProviderSchema = Type.Union([
	Ref(GoogleProviderSchema),
	Ref(NextcloudProviderSchema),
	Ref(CalDavProviderSchema)
], { $id: 'Provider', title: 'Provider', description: 'An external service and the calendars it serves.' });

// Canonical weekday tokens in ISO order (Temporal's dayOfWeek: mon=1 … sun=7).
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const WeekdaySchema = Type.Union(
	WEEKDAYS.map((d) => Type.Literal(d)),
	{ $id: 'Weekday', title: 'Weekday', description: 'A day of the week (mon, tue, wed, thu, fri, sat, sun).' }
);

export const TimeSchema = Type.String({
	$id: 'Time',
	pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$',
	title: 'Time',
	description: 'A wall-clock time as HH:MM (24-hour) in the user\'s timezone.'
});

export const AvailabilityRuleSchema = Type.Object({
	days: Type.Array(Ref(WeekdaySchema), { minItems: 1, description: 'Weekdays this window applies to.' }),
	from: Ref(TimeSchema, { description: 'Start of the available window (HH:MM).' }),
	to: Ref(TimeSchema, { description: 'End of the available window (HH:MM).' })
}, { $id: 'AvailabilityRule', additionalProperties: false, title: 'AvailabilityRule', description: 'An available time window applied to one or more weekdays. Repeat with the same days for multiple windows.' });

export const WeeklyAvailabilitySchema = Type.Array(
	Ref(AvailabilityRuleSchema),
	{ $id: 'WeeklyAvailability', minItems: 1, title: 'WeeklyAvailability', description: 'Weekly availability as a list of rules. Availability is the union of all rules; a weekday named by no rule is unavailable.' }
);

export const ScheduleSchema = Type.Object({
	weekly: Ref(WeeklyAvailabilitySchema, { description: 'Weekly working hours as availability rules. Defaults to Monday-Friday 09:00-17:00 when omitted.' })
}, { $id: 'Schedule', additionalProperties: false, title: 'Schedule', description: 'Schedule defining weekly working hours.' });

export const LocationSchema = Type.String({
	$id: 'Location',
	title: 'Location',
	minLength: 1,
	description: 'A static location description for a meeting (e.g. an address, a phone number, or a static meeting link).'
});

export const FieldConditionSchema = Type.Object({
	field: Type.String({ minLength: 1, description: 'Name of an earlier field whose value this condition tests.' }),
	equals: Type.Optional(Type.Union([
		Type.String(),
		Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })
	], { description: 'Value, or list of accepted values, the referenced field must match. Omit to require only that the field has a non-empty value.' }))
}, { $id: 'FieldCondition', additionalProperties: false, title: 'FieldCondition', description: 'A visibility condition referencing another field.' });

const formFieldBase = {
	name: Type.String({ minLength: 1, description: 'Unique name for the form field.' }),
	label: Type.String({ minLength: 1, description: 'The question prompt or label shown to the user.' }),
	required: Type.Boolean({ default: false, description: 'Whether the field must be filled in (default: false).' }),
	show_when: Type.Optional(Type.Array(Ref(FieldConditionSchema), { description: 'Show this field only when every listed condition holds (logical AND). Each condition references an earlier field.' }))
};

const ChoicesSchema = Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: 'The options offered, in the order shown.' });

// Split on `type` so the schema itself says where `choices` belongs: required for a
// choice field, optional for event_location, and rejected on the rest.
export const FormFieldSchema = Type.Union([
	Type.Object({
		...formFieldBase,
		type: Type.Literal('choice', { description: 'A pick-one list; `choices` lists the options.' }),
		choices: ChoicesSchema
	}, { additionalProperties: false, title: 'Choice field' }),
	Type.Object({
		...formFieldBase,
		type: Type.Literal('event_location', { description: 'Where the meeting happens. With `choices` the guest picks one; without, they type it.' }),
		choices: Type.Optional(ChoicesSchema)
	}, { additionalProperties: false, title: 'Event location field' }),
	Type.Object({
		...formFieldBase,
		type: Type.Union([
			Type.Literal('guest_name'),
			Type.Literal('guest_email'),
			Type.Literal('text'),
			Type.Literal('number'),
			Type.Literal('phone'),
			Type.Literal('paragraph')
		], { description: 'Type of form field (guest_name, guest_email, text, number, phone, paragraph).' })
	}, { additionalProperties: false, title: 'Plain field' })
], { $id: 'FormField', title: 'FormField', description: 'Custom question form fields for bookings.' });

export const MeetingSchema = Type.Object({
	title: Type.String({ minLength: 1, description: 'Name shown to guests (e.g. 30-minute chat).' }),
	duration_minutes: Type.Integer({ minimum: 1, default: 30, description: 'Length of the meeting in minutes (default: 30). This is the default selection when more lengths are offered.' }),
	additional_duration_minutes: Type.Array(Type.Integer({ minimum: 1 }), { default: [], description: 'Further lengths the guest may choose from, shown after duration_minutes.' }),
	description: Type.Optional(Type.String({ description: 'Brief description of the meeting.' })),
	visibility: Type.Union([Type.Literal('public'), Type.Literal('unlisted')], { default: 'public', description: 'Whether this meeting is listed on the homepage. "unlisted" only hides it from that list — anyone with the /schedule/<slug> link can still book it.' }),
	require_approval: Type.Boolean({ default: true, description: 'Whether the host must approve a booking before it is confirmed (default: true). False confirms instantly.' }),
	additional_busy_calendars: Type.Array(Type.String({ minLength: 1 }), { default: [], description: 'Further calendar names to check for conflicts (busy times) to block slots. The booking_calendar is always checked and never needs listing here.' }),
	booking_calendar: Type.String({ minLength: 1, description: 'Calendar name where confirmed bookings will be written.' }),
	schedule: Type.String({ minLength: 1, description: 'Name of the schedule to use for availability.' }),
	show_slots: Type.Boolean({ default: false, description: 'Render the bookable slots as buttons (default: false). When false the timeline is bare and dragging snaps to the same slots.' }),
	location: Type.Optional(Ref(LocationSchema, { description: 'Static location of the meeting.' })),
	note: Type.Optional(Type.String({ minLength: 1, description: 'A note shown to guests after booking.' })),
	video_chat_provider: Type.Optional(Type.String({ minLength: 1, description: 'Name of the provider to generate dynamic links.' })),
	start_times_every_minutes: Type.Optional(Type.Integer({ minimum: 1, description: 'Time step in minutes; booking slots will snap to this boundary. Defaults to the meeting\'s duration_minutes. A step shorter than the longest offered length makes the slots overlap, which is only visible with show_slots.' })),
	notice_minutes: Type.Integer({ minimum: 0, default: 120, description: 'Minimum lead time required for bookings in minutes (default: 120).' }),
	booking_window_days: Type.Integer({ minimum: 1, default: 60, description: 'Maximum number of days in the future that are open for booking (default: 60).' }),
	padding_before_minutes: Type.Integer({ minimum: 0, default: 0, description: 'Minutes of padding time required before each appointment (default: 0).' }),
	padding_after_minutes: Type.Integer({ minimum: 0, default: 0, description: 'Minutes of padding time required after each appointment (default: 0).' }),
	daily_booking_limit: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()], { default: null, description: 'Maximum number of appointments allowed in a single day. null means unlimited (default: null).' }),
	form_fields: Type.Optional(Type.Array(Ref(FormFieldSchema), { minItems: 1, maxItems: 10, description: 'Custom form fields for the booking process.' }))
}, { $id: 'Meeting', additionalProperties: false, title: 'Meeting', description: 'Definition of a bookable meeting.' });

export const DatabaseSchema = Type.Object({
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
}, { $id: 'Database', additionalProperties: false, title: 'Database', description: 'On-disk SQLite paths. Relative paths resolve against the config directory\'s parent (the deployment root that holds config/ and data/ as siblings), so web and worker (which load the same when.yaml) open the same files.' });

export const UrlSchema = Type.Object({
	app: Type.String({
		description: 'Public base URL of the app (include the scheme), used to build links in emails and calendar events. Defaults to the ORIGIN env var, which adapter-node needs anyway to sit behind a reverse proxy — set ORIGIN alone and both agree.',
		minLength: 1,
		default: '${ORIGIN:-http://localhost:5173}'
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

export const PrometheusSchema = Type.Object({
	enabled: Type.Boolean({ description: 'Whether metrics collection and endpoint are active.', default: false }),
	token: Type.String({ description: 'Bearer token for scraping metrics. Defaults to the WHEN_METRICS_TOKEN environment variable.', default: '${WHEN_METRICS_TOKEN:-}' })
}, { $id: 'Prometheus', additionalProperties: false, title: 'Prometheus', description: 'Prometheus metrics collection settings.' });

export const WhenConfigurationSchema = Type.Object({
	version: Type.Literal(1, { default: 1, description: 'Shape version of this file. Always 1 today; a future breaking change to the config layout would increment it.' }),
	auth: Ref(AuthSchema, { description: 'Admin authentication configuration.' }),
	user: Ref(UserSchema, { description: 'Details about the schedule owner.' }),
	smtp: Ref(SmtpSchema, { description: 'SMTP email server settings.' }),
	providers: Type.Record(Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }), Ref(ProviderSchema, { default: {} }), { additionalProperties: false, default: {}, description: 'Third-party services and the calendars they serve, keyed by name.' }),
	schedules: Type.Record(Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }), Ref(ScheduleSchema, { default: {} }), { additionalProperties: false, minProperties: 1, description: 'Availability schedules, keyed by the name meetings reference.' }),
	meetings: Type.Record(Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }), Ref(MeetingSchema, { default: {} }), { additionalProperties: false, minProperties: 1, description: 'Bookable meetings, keyed by the slug their booking page uses (/schedule/<key>).' }),
	database: Ref(DatabaseSchema, { default: {}, description: 'Local SQLite database file paths.' }),
	url: Ref(UrlSchema, { default: {}, description: 'Server and client URL configuration.' }),
	prometheus: Ref(PrometheusSchema, { default: {}, description: 'Prometheus metrics settings.' })
}, {
	additionalProperties: false,
	title: 'When configuration',
	description: 'Canonical schema for the When self-hosted scheduling app\'s when.yaml.'
});

export type WhenConfiguration = Static<typeof WhenConfigurationSchema>;
export type Auth = Static<typeof AuthSchema>;
export type CredentialsAuth = Static<typeof CredentialsAuthSchema>;
export type OidcAuth = Static<typeof OidcAuthSchema>;
export type User = Static<typeof UserSchema>;
export type Appearance = Static<typeof AppearanceSchema>;
export type Smtp = Static<typeof SmtpSchema>;
export type Provider = Static<typeof ProviderSchema>;
export type GoogleProvider = Static<typeof GoogleProviderSchema>;
export type NextcloudProvider = Static<typeof NextcloudProviderSchema>;
export type CalDavProvider = Static<typeof CalDavProviderSchema>;
export type Calendar = Static<typeof GoogleCalendarSchema> | Static<typeof CalDavCalendarSchema>;
export type GoogleCalendar = Static<typeof GoogleCalendarSchema>;
export type CalendarSync = Static<typeof CalendarSyncSchema>;
export type CalDavCalendar = Static<typeof CalDavCalendarSchema>;
export type Schedule = Static<typeof ScheduleSchema>;
export type WeeklyAvailability = Static<typeof WeeklyAvailabilitySchema>;
export type AvailabilityRule = Static<typeof AvailabilityRuleSchema>;
export type Weekday = Static<typeof WeekdaySchema>;
export type Meeting = Static<typeof MeetingSchema>;
export type FormField = Static<typeof FormFieldSchema>;
export type FieldCondition = Static<typeof FieldConditionSchema>;
export type Location = Static<typeof LocationSchema>;
export type Prometheus = Static<typeof PrometheusSchema>;
export type Database = Static<typeof DatabaseSchema>;
export type Url = Static<typeof UrlSchema>;
