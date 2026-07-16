import { define } from 'gunshi';
import { text, select, multiselect, isCancel, spinner, note } from '@clack/prompts';
import { ConfigEditor, MeetingSchema, type Service } from '@when/config';
import { getValidatedConfigPath, validateConfigExists } from '../../utils/config-path.ts';
import { schemaDefault } from '../../utils/schema-defaults.ts';

const CANCEL = Symbol('cancel');

// Fields the wizard covers vs. ones it deliberately leaves for hand-editing.
// The drift test asserts their union equals MeetingSchema.properties, so a new
// schema field fails CLI tests until the wizard learns it (or skips it here).
export const MEETING_SKIPPED_FIELDS = ['form_fields', 'booking_style', 'start_times_every_minutes'];
export const MEETING_HANDLED_FIELDS = [
	'name',
	'duration_minutes',
	'description',
	'slug',
	'visibility',
	'booking_approval',
	'busy_calendars',
	'booking_calendar',
	'schedule',
	'location',
	'note',
	'video_chat_service',
	'notice_minutes',
	'booking_window_days',
	'padding_before_minutes',
	'padding_after_minutes',
	'daily_booking_limit'
];

type MeetingPoint = { location?: string; videoService?: string };

interface MeetingAnswers {
	name: string;
	slug: string;
	duration: number;
	bookingApproval: string;
	visibility: string;
	schedule: string;
	bookingCalendar: string;
	description: string;
	busyCalendars: string[];
	point: MeetingPoint;
	note: string;
	notice: number;
	windowDays: number;
	padBefore: number;
	padAfter: number;
	dailyLimit: number | null;
}

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

async function promptName(existingNames: string[]): Promise<string | null> {
	const val = await text({
		message: 'What is the meeting name?',
		placeholder: '30-minute chat',
		validate(v) {
			if (!v || !v.trim()) return 'Name is required';
			if (existingNames.includes(v.trim())) return `A meeting named "${v.trim()}" already exists.`;
		}
	});
	return isCancel(val) ? null : val.trim();
}

async function promptSlug(name: string): Promise<string | null> {
	const derived = slugify(name);
	const val = await text({
		message: 'URL slug for the booking page?',
		placeholder: derived,
		defaultValue: derived,
		validate(v) {
			const s = (v ?? '').trim() || derived;
			if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) {
				return 'Lowercase letters, numbers, and hyphens; must start with a letter or number.';
			}
		}
	});
	if (isCancel(val)) return null;
	return (val as string).trim() || derived;
}

async function promptOptional(message: string): Promise<string | null> {
	const val = await text({ message, placeholder: '' });
	return isCancel(val) ? null : val.trim();
}

async function promptEnum(
	message: string,
	key: string,
	options: { value: string; label: string }[]
): Promise<string | null> {
	const val = await select({
		message,
		options,
		initialValue: schemaDefault<string>(MeetingSchema, key)
	});
	return isCancel(val) ? null : (val as string);
}

async function promptFromList(message: string, names: string[]): Promise<string | null> {
	const val = await select({
		message,
		options: names.map((n) => ({ value: n, label: n })),
		initialValue: names[0]
	});
	return isCancel(val) ? null : (val as string);
}

async function promptMeetingPoint(videoServices: Service[]): Promise<MeetingPoint | null> {
	const choice = await select({
		message: 'How will guests meet?',
		options: [
			{ value: 'none', label: 'No fixed location' },
			{ value: 'location', label: 'Static location (address, phone, or link)' },
			...(videoServices.length ? [{ value: 'video', label: 'Generated video links' }] : [])
		],
		initialValue: 'none'
	});
	if (isCancel(choice)) return null;

	if (choice === 'location') {
		const locVal = await text({
			message: 'Location (address, phone, or link):',
			validate(v) {
				if (!v || !v.trim()) return 'Location is required';
			}
		});
		if (isCancel(locVal)) return null;
		return { location: locVal.trim() };
	}
	if (choice === 'video') {
		const svc = await select({
			message: 'Which service generates the video links?',
			options: videoServices.map((s) => ({ value: s.name, label: `${s.name} (${s.type})` }))
		});
		if (isCancel(svc)) return null;
		return { videoService: svc as string };
	}
	return {};
}

async function promptBusyCalendars(names: string[]): Promise<string[] | null> {
	const val = await multiselect({
		message: 'Which calendars block busy times? (optional)',
		options: names.map((n) => ({ value: n, label: n })),
		required: false,
		initialValues: []
	});
	return isCancel(val) ? null : (val as string[]);
}

async function promptInt(message: string, key: string, min: number): Promise<number | null> {
	const def = schemaDefault<number>(MeetingSchema, key);
	const val = await text({
		message,
		placeholder: String(def),
		defaultValue: String(def),
		validate(v) {
			const s = (v ?? '').trim();
			if (!s) return;
			if (!/^\d+$/.test(s)) return 'Must be a whole number';
			if (Number(s) < min) return `Must be ${min} or more`;
		}
	});
	if (isCancel(val)) return null;
	const s = (val as string).trim();
	return s ? Number(s) : def;
}

async function promptDailyLimit(): Promise<number | null | typeof CANCEL> {
	const val = await text({
		message: 'Maximum bookings per day (leave blank for unlimited):',
		placeholder: 'unlimited',
		validate(v) {
			const s = (v ?? '').trim();
			if (!s) return;
			if (!/^\d+$/.test(s) || Number(s) < 1) return 'Must be a positive whole number';
		}
	});
	if (isCancel(val)) return CANCEL;
	const s = (val as string).trim();
	return s ? Number(s) : null;
}

function buildMeeting(a: MeetingAnswers): Record<string, unknown> {
	const meeting: Record<string, unknown> = {
		name: a.name,
		slug: a.slug,
		duration_minutes: a.duration,
		booking_approval: a.bookingApproval,
		visibility: a.visibility,
		schedule: a.schedule,
		booking_calendar: a.bookingCalendar
	};
	if (a.description) meeting.description = a.description;
	if (a.busyCalendars.length) meeting.busy_calendars = a.busyCalendars;
	if (a.point.location) meeting.location = a.point.location;
	if (a.point.videoService) meeting.video_chat_service = a.point.videoService;
	if (a.note) meeting.note = a.note;
	meeting.notice_minutes = a.notice;
	meeting.booking_window_days = a.windowDays;
	meeting.padding_before_minutes = a.padBefore;
	meeting.padding_after_minutes = a.padAfter;
	meeting.daily_booking_limit = a.dailyLimit;
	return meeting;
}

export const meetingsAddCommand = define({
	name: 'add',
	description: 'Wizard to add a bookable meeting',
	args: {
		config: {
			type: 'string',
			short: 'c',
			description: 'Path to when.yaml file'
		}
	},
	async run(ctx) {
		const configPath = getValidatedConfigPath(ctx.values.config);
		if (!validateConfigExists(configPath)) return;

		const editor = new ConfigEditor(configPath);
		const calendars = (editor.get('calendars') as { name: string }[]) ?? [];
		const schedules = (editor.get('schedules') as { name: string }[]) ?? [];
		const services = (editor.get('services') as Service[]) ?? [];
		const meetings = (editor.get('meetings') as { name: string }[]) ?? [];

		if (calendars.length === 0) {
			note(
				'Add a calendar first:\n  when-cli calendars add <google|caldav|nextcloud>',
				'No calendars configured'
			);
			return;
		}
		if (schedules.length === 0) {
			note('Add a schedule first:\n  when-cli schedules add', 'No schedules configured');
			return;
		}

		const calendarNames = calendars.map((c) => c.name);
		const scheduleNames = schedules.map((s) => s.name);
		const videoServices = services.filter((s) => s.type === 'google' || s.type === 'nextcloud');

		const name = await promptName(meetings.map((m) => m.name));
		if (name == null) return;
		const duration = await promptInt('Duration in minutes?', 'duration_minutes', 1);
		if (duration == null) return;
		const description = await promptOptional('Short description (optional):');
		if (description == null) return;
		const slug = await promptSlug(name);
		if (slug == null) return;
		const bookingApproval = await promptEnum('How are bookings approved?', 'booking_approval', [
			{ value: 'request', label: 'Request — host approves each booking' },
			{ value: 'instant', label: 'Instant — auto-confirm' }
		]);
		if (bookingApproval == null) return;
		const visibility = await promptEnum('Homepage visibility?', 'visibility', [
			{ value: 'public', label: 'Public — listed on the homepage' },
			{ value: 'private', label: 'Private — hidden, shareable by link' }
		]);
		if (visibility == null) return;
		const point = await promptMeetingPoint(videoServices);
		if (point == null) return;
		const schedule = await promptFromList('Which schedule sets availability?', scheduleNames);
		if (schedule == null) return;
		const bookingCalendar = await promptFromList(
			'Which calendar receives confirmed bookings?',
			calendarNames
		);
		if (bookingCalendar == null) return;
		const busyCalendars = await promptBusyCalendars(calendarNames);
		if (busyCalendars == null) return;
		const guestNote = await promptOptional('Note shown to guests after booking (optional):');
		if (guestNote == null) return;
		const notice = await promptInt('Minimum notice in minutes?', 'notice_minutes', 0);
		if (notice == null) return;
		const windowDays = await promptInt('Booking window in days?', 'booking_window_days', 1);
		if (windowDays == null) return;
		const padBefore = await promptInt(
			'Padding before each meeting (minutes)?',
			'padding_before_minutes',
			0
		);
		if (padBefore == null) return;
		const padAfter = await promptInt(
			'Padding after each meeting (minutes)?',
			'padding_after_minutes',
			0
		);
		if (padAfter == null) return;
		const dailyLimit = await promptDailyLimit();
		if (dailyLimit === CANCEL) return;

		const meeting = buildMeeting({
			name,
			slug,
			duration,
			bookingApproval,
			visibility,
			schedule,
			bookingCalendar,
			description,
			busyCalendars,
			point,
			note: guestNote,
			notice,
			windowDays,
			padBefore,
			padAfter,
			dailyLimit
		});

		const s = spinner();
		s.start('Saving meeting...');
		try {
			editor.set(`meetings.${meetings.length}`, meeting);
			s.stop(`Successfully added meeting "${name}" to when.yaml!`);
		} catch (err) {
			s.stop('Failed to save!');
			console.error(err);
			process.exitCode = 1;
		}
	}
});
