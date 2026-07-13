// Fields whose default depends on sibling values, so they can't be static schema
// defaults. Filled before schema validation, keeping the fields `required`.
export function withDerivedDefaults(config: unknown): unknown {
	if (!isRecord(config) || !Array.isArray(config.meetings)) return config;

	const schedule = soleName(config.schedules);
	const calendar = soleName(config.calendars);

	return {
		...config,
		meetings: config.meetings.map((meeting) =>
			isRecord(meeting) ? deriveMeetingDefaults(meeting, schedule, calendar) : meeting
		)
	};
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

// The one entry's name, or undefined unless the list holds exactly one.
function soleName(list: unknown): string | undefined {
	if (!Array.isArray(list) || list.length !== 1) return undefined;
	const only = list[0];
	return isRecord(only) && typeof only.name === 'string' ? only.name : undefined;
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
