import type {
	CalDavCalendar,
	CalDavProvider,
	GoogleCalendar,
	GoogleProvider,
	NextcloudProvider,
	WhenConfiguration
} from './schema.js';

interface Named {
	name: string;
	providerName: string;
}

export type ResolvedCalendar =
	| (Named & { type: 'google'; provider: GoogleProvider; calendar: GoogleCalendar })
	| (Named & {
			type: 'caldav';
			provider: CalDavProvider | NextcloudProvider;
			calendar: CalDavCalendar;
	  });

export function allCalendars(cfg: Pick<WhenConfiguration, 'providers'>): ResolvedCalendar[] {
	const resolved: ResolvedCalendar[] = [];
	for (const [providerName, provider] of Object.entries(cfg.providers)) {
		for (const [name, calendar] of Object.entries(provider.calendars)) {
			resolved.push(
				provider.type === 'google'
					? { type: 'google', name, providerName, provider, calendar }
					: { type: 'caldav', name, providerName, provider, calendar }
			);
		}
	}
	return resolved;
}

export function findCalendar(
	cfg: Pick<WhenConfiguration, 'providers'>,
	name: string
): ResolvedCalendar | undefined {
	return allCalendars(cfg).find((entry) => entry.name === name);
}

export function calendarNames(cfg: Pick<WhenConfiguration, 'providers'>): string[] {
	return allCalendars(cfg).map((entry) => entry.name);
}

/** The config field that points a calendar at its provider, and what it holds. */
export function calendarTarget(resolved: ResolvedCalendar): { field: string; value: string } {
	return resolved.type === 'google'
		? { field: 'id', value: resolved.calendar.id }
		: { field: 'href', value: resolved.calendar.href };
}
