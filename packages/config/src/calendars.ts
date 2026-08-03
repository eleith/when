import type {
	CalDavCalendar,
	CalDavProvider,
	GoogleCalendar,
	GoogleProvider,
	NextcloudProvider,
	WhenConfiguration
} from './schema.js';

export type ResolvedCalendar =
	| { type: 'google'; provider: GoogleProvider; calendar: GoogleCalendar }
	| { type: 'caldav'; provider: CalDavProvider | NextcloudProvider; calendar: CalDavCalendar };

export function allCalendars(cfg: Pick<WhenConfiguration, 'providers'>): ResolvedCalendar[] {
	const resolved: ResolvedCalendar[] = [];
	for (const provider of cfg.providers) {
		if (provider.type === 'google') {
			for (const calendar of provider.calendars) {
				resolved.push({ type: 'google', provider, calendar });
			}
		} else {
			for (const calendar of provider.calendars) {
				resolved.push({ type: 'caldav', provider, calendar });
			}
		}
	}
	return resolved;
}

export function findCalendar(
	cfg: Pick<WhenConfiguration, 'providers'>,
	name: string
): ResolvedCalendar | undefined {
	return allCalendars(cfg).find((entry) => entry.calendar.name === name);
}

export function calendarNames(cfg: Pick<WhenConfiguration, 'providers'>): string[] {
	return allCalendars(cfg).map((entry) => entry.calendar.name);
}
