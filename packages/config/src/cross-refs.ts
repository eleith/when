import type { WhenConfiguration } from './schema.js';
import type { ConfigIssue } from './load.js';

export function checkCrossRefs(cfg: WhenConfiguration): ConfigIssue[] {
	const issues: ConfigIssue[] = [];
	const calendarIds = new Set<string>();

	cfg.calendars.forEach((cal, i) => {
		if (calendarIds.has(cal.id)) {
			issues.push({
				path: `/calendars/${i}/id`,
				message: `duplicate calendar id "${cal.id}"`
			});
		}
		calendarIds.add(cal.id);
	});

	const seenEventIds = new Set<string>();
	const seenSlugs = new Set<string>();

	cfg.event_types.forEach((et, i) => {
		if (seenEventIds.has(et.id)) {
			issues.push({
				path: `/event_types/${i}/id`,
				message: `duplicate event_type id "${et.id}"`
			});
		}
		seenEventIds.add(et.id);

		if (seenSlugs.has(et.slug)) {
			issues.push({
				path: `/event_types/${i}/slug`,
				message: `duplicate event_type slug "${et.slug}"`
			});
		}
		seenSlugs.add(et.slug);

		if (!calendarIds.has(et.destination_calendar)) {
			issues.push({
				path: `/event_types/${i}/destination_calendar`,
				message: `references unknown calendar id "${et.destination_calendar}"`
			});
		}

		(et.conflict_calendars ?? []).forEach((cid, j) => {
			if (!calendarIds.has(cid)) {
				issues.push({
					path: `/event_types/${i}/conflict_calendars/${j}`,
					message: `references unknown calendar id "${cid}"`
				});
			}
		});
	});

	return issues;
}
