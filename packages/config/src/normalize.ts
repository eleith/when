// Fields whose default depends on sibling values, so they can't be static schema
// defaults. Filled before schema validation (the fields stay `required` in the
// source schema for strict types); the generated editor schema relaxes them, so
// the definition + field names are listed here as the single source of truth.
export const DERIVED_OPTIONAL: Record<string, string[]> = {
	Meeting: ['slug', 'schedule', 'booking_calendar'],
	Schedule: ['weekly']
};

export function withDerivedDefaults(config: unknown): unknown {
	if (!isRecord(config)) return config;

	const result = { ...config };
	if (Array.isArray(config.schedules)) {
		result.schedules = config.schedules.map((schedule) =>
			isRecord(schedule) ? deriveScheduleDefaults(schedule) : schedule
		);
	}
	if (Array.isArray(config.meetings)) {
		const schedule = firstName(config.schedules);
		const calendar = firstName(config.calendars);
		result.meetings = config.meetings.map((meeting) =>
			isRecord(meeting) ? deriveMeetingDefaults(meeting, schedule, calendar) : meeting
		);
	}
	return result;
}

// Fill an omitted week with a Monday–Friday 09:00–17:00 rule.
function deriveScheduleDefaults(schedule: Record<string, unknown>): Record<string, unknown> {
	if (schedule.weekly !== undefined) return schedule;
	return { ...schedule, weekly: businessWeek() };
}

function businessWeek(): Array<Record<string, unknown>> {
	return [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }];
}

function deriveMeetingDefaults(
	meeting: Record<string, unknown>,
	schedule: string | undefined,
	calendar: string | undefined
): Record<string, unknown> {
	const derived: Record<string, unknown> = {};
	if (meeting.slug === undefined && typeof meeting.name === 'string') {
		derived.slug = slugify(meeting.name);
	}
	if (meeting.schedule === undefined && schedule !== undefined) {
		derived.schedule = schedule;
	}
	if (meeting.booking_calendar === undefined && calendar !== undefined) {
		derived.booking_calendar = calendar;
	}
	return { ...meeting, ...derived };
}

// The first entry's name, used as the default schedule/calendar for a meeting.
function firstName(list: unknown): string | undefined {
	if (!Array.isArray(list) || list.length === 0) return undefined;
	const first = list[0];
	return isRecord(first) && typeof first.name === 'string' ? first.name : undefined;
}

function slugify(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
