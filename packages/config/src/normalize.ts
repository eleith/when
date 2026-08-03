// Fields whose default depends on sibling values, so they can't be static schema
// defaults. Filled before schema validation (the fields stay `required` in the
// source schema for strict types); the generated editor schema relaxes them, so
// the definition + field names are listed here as the single source of truth.
export const DERIVED_OPTIONAL: Record<string, string[]> = {
	Schedule: ['weekly']
};

export function withDerivedDefaults(config: unknown): unknown {
	if (!isRecord(config)) return config;
	if (!isRecord(config.schedules)) return config;

	const schedules: Record<string, unknown> = {};
	for (const [name, schedule] of Object.entries(config.schedules)) {
		schedules[name] = isRecord(schedule) ? deriveScheduleDefaults(schedule) : schedule;
	}
	return { ...config, schedules };
}

// Fill an omitted week with a Monday–Friday 09:00–17:00 rule.
function deriveScheduleDefaults(schedule: Record<string, unknown>): Record<string, unknown> {
	if (schedule.weekly !== undefined) return schedule;
	return { ...schedule, weekly: businessWeek() };
}

function businessWeek(): Array<Record<string, unknown>> {
	return [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
