import { Type, type TSchema, type SchemaOptions, type Static } from '@sinclair/typebox';

// Custom Ref wrapper to avoid deprecation warnings in TypeBox 0.34.0+
const Ref = <T extends TSchema>(schema: T, options?: SchemaOptions) =>
	Type.Unsafe<Static<T>>(Type.Ref(schema.$id!, options));

export const HexColorSchema = Type.String({
	$id: 'HexColor',
	pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'
});

export const OidcAuthSchema = Type.Object({
	issuer: Type.String({ format: 'uri' }),
	client_id: Type.String({ minLength: 1 }),
	client_secret: Type.String({ minLength: 1 })
}, { $id: 'OidcAuth', additionalProperties: false, title: 'OidcAuth' });

export const CredentialsAuthSchema = Type.Object({
	username: Type.String({ minLength: 1 }),
	password: Type.String({
		minLength: 1,
		default: '${WHEN_ADMIN_PASSWORD}'
	})
}, { $id: 'CredentialsAuth', additionalProperties: false, title: 'CredentialsAuth', description: 'Local username/password.' });

export const AuthSchema = Type.Union([
	Type.Object({
		oidc: Ref(OidcAuthSchema),
		credentials: Type.Optional(Type.Null())
	}, { additionalProperties: false }),
	Type.Object({
		credentials: Ref(CredentialsAuthSchema),
		oidc: Type.Optional(Type.Null())
	}, { additionalProperties: false })
], {
	$id: 'Auth',
	title: 'Auth',
	description: 'Admin auth strategy. Exactly one of `oidc` or `credentials` must be declared.'
});

export const BrandingSchema = Type.Object({
	logo_url: Type.Optional(Type.String({ minLength: 1 })),
	color: Type.Object({
		primary: Type.Object({
			light: Ref(HexColorSchema, { default: '#4f46e5' }),
			dark: Ref(HexColorSchema, { default: '#818cf8' })
		}, { additionalProperties: false, default: {} })
	}, { additionalProperties: false, default: {}, required: ['primary'] }),
	avatar_url: Type.Optional(Type.String({ minLength: 1 })),
	favicon_url: Type.Optional(Type.String({ minLength: 1 })),
	page_title: Type.Optional(Type.String({ minLength: 1 })),
	description: Type.Optional(Type.String({ minLength: 1 }))
}, { $id: 'Branding', additionalProperties: false, title: 'Branding' });

export const UserSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	timezone: Type.String({
		description: 'IANA timezone identifier (e.g. America/New_York).',
		minLength: 1
	}),
	email: Type.String({ format: 'email' }),
	branding: Ref(BrandingSchema, { default: {} })
}, { $id: 'User', additionalProperties: false, title: 'User' });

export const SmtpSchema = Type.Object({
	host: Type.String({ minLength: 1 }),
	port: Type.Integer({ minimum: 1, maximum: 65535 }),
	user: Type.String({ minLength: 1 }),
	pass: Type.String({ minLength: 1 }),
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

export const GoogleCalendarSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	type: Type.Literal('google'),
	client_id: Type.String({ minLength: 1 }),
	client_secret: Type.String({ minLength: 1 }),
	refresh_token: Type.String({ minLength: 1 }),
	google_calendar_id: Type.String({ minLength: 1 }),
	sync: Type.Optional(Ref(CalendarSyncSchema))
}, { $id: 'GoogleCalendar', additionalProperties: false, title: 'GoogleCalendar' });

export const CalDavCalendarSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	type: Type.Literal('caldav'),
	url: Type.String({ format: 'uri' }),
	username: Type.String({ minLength: 1 }),
	password: Type.String({ minLength: 1 }),
	sync: Type.Optional(Ref(CalendarSyncSchema))
}, { $id: 'CalDavCalendar', additionalProperties: false, title: 'CalDavCalendar' });

export const CalendarSchema = Type.Union([
	Ref(GoogleCalendarSchema),
	Ref(CalDavCalendarSchema)
], { $id: 'Calendar', title: 'Calendar' });

export const DayScheduleSchema = Type.Array(
	Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$' }),
	{ $id: 'DaySchedule', title: 'DaySchedule', description: 'Array of HH:MM-HH:MM time ranges in the user\'s timezone.' }
);

export const WeeklyScheduleSchema = Type.Object({
	monday: Type.Optional(Ref(DayScheduleSchema)),
	tuesday: Type.Optional(Ref(DayScheduleSchema)),
	wednesday: Type.Optional(Ref(DayScheduleSchema)),
	thursday: Type.Optional(Ref(DayScheduleSchema)),
	friday: Type.Optional(Ref(DayScheduleSchema)),
	saturday: Type.Optional(Ref(DayScheduleSchema)),
	sunday: Type.Optional(Ref(DayScheduleSchema))
}, { $id: 'WeeklySchedule', additionalProperties: false, title: 'WeeklySchedule' });

export const AvailabilitySchema = Type.Object({
	slot_granularity: Type.Optional(Type.Integer({ minimum: 1, default: 15 })),
	minimum_notice: Type.Optional(Type.Integer({ minimum: 0, default: 120 })),
	maximum_lookahead: Type.Optional(Type.Integer({ minimum: 1, default: 60 })),
	buffer_before: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
	buffer_after: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
	max_appointments_per_day: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()], { default: null })),
	default: Ref(WeeklyScheduleSchema)
}, { $id: 'Availability', additionalProperties: false, title: 'Availability', description: 'Global availability defaults. Each knob is overridable per event type.' });

export const LocationFixedSchema = Type.Object({
	mode: Type.Literal('fixed'),
	fixed: Type.String({ minLength: 1 })
}, { $id: 'LocationFixed', additionalProperties: false, title: 'LocationFixed' });

export const LocationSchema = Type.Union([
	Ref(LocationFixedSchema)
], { $id: 'Location', title: 'Location' });

export const FormFieldSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	type: Type.Union([
		Type.Literal('guest_name'),
		Type.Literal('guest_email'),
		Type.Literal('event_location'),
		Type.Literal('text'),
		Type.Literal('number'),
		Type.Literal('paragraph'),
		Type.Literal('choice')
	]),
	label: Type.String({ minLength: 1 }),
	required: Type.Boolean({ default: false }),
	choices: Type.Optional(Type.Array(Type.String({ minLength: 1 })))
}, { $id: 'FormField', additionalProperties: false, title: 'FormField' });

export const EventTypeSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.String({ minLength: 1 }),
	duration: Type.Integer({ minimum: 1 }),
	description: Type.Optional(Type.String()),
	slug: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }),
	visibility: Type.Optional(Type.Union([Type.Literal('public'), Type.Literal('private')], { default: 'public' })),
	appointment_flow: Type.Union([Type.Literal('auto'), Type.Literal('requires_confirmation')]),
	conflict_calendars: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { default: [] })),
	destination_calendar: Type.String({ minLength: 1 }),
	location: Type.Optional(Ref(LocationSchema)),
	note: Type.Optional(Type.String({ minLength: 1 })),
	conference: Type.Optional(Type.String({ format: 'uri' })),
	slot_granularity: Type.Optional(Type.Integer({ minimum: 1 })),
	minimum_notice: Type.Optional(Type.Integer({ minimum: 0 })),
	maximum_lookahead: Type.Optional(Type.Integer({ minimum: 1 })),
	buffer_before: Type.Optional(Type.Integer({ minimum: 0 })),
	buffer_after: Type.Optional(Type.Integer({ minimum: 0 })),
	max_appointments_per_day: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
	image_url: Type.Optional(Type.String({ minLength: 1 })),
	form_fields: Type.Optional(Type.Array(Ref(FormFieldSchema)))
}, { $id: 'EventType', additionalProperties: false, title: 'EventType' });

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
	auth: Ref(AuthSchema),
	user: Ref(UserSchema),
	smtp: Ref(SmtpSchema),
	calendars: Type.Array(Ref(CalendarSchema)),
	availability: Ref(AvailabilitySchema),
	event_types: Type.Array(Ref(EventTypeSchema), { minItems: 1 }),
	database: Ref(DatabaseConfigSchema, { default: {} }),
	url: Ref(UrlSchema, { default: {} }),
	prometheus: Ref(PrometheusConfigSchema, { default: {} })
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
export type LocationFixed = Static<typeof LocationFixedSchema>;
export type PrometheusConfig = Static<typeof PrometheusConfigSchema>;
export type DatabaseConfig = Static<typeof DatabaseConfigSchema>;
export type Url = Static<typeof UrlSchema>;
