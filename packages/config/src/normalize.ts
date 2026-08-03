// Fields whose default depends on sibling values, so they can't be static schema
// defaults. Filled before schema validation (the fields stay `required` in the
// source schema for strict types); the generated editor schema relaxes them, so
// the definition + field names are listed here as the single source of truth.
export const DERIVED_OPTIONAL: Record<string, string[]> = {
	Meeting: ['slug'],
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
		result.meetings = config.meetings.map((meeting) =>
			isRecord(meeting) ? deriveMeetingDefaults(meeting) : meeting
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

function deriveMeetingDefaults(meeting: Record<string, unknown>): Record<string, unknown> {
	if (meeting.slug !== undefined || typeof meeting.name !== 'string') return meeting;
	return { ...meeting, slug: slugify(meeting.name) };
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
