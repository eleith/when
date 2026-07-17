import type { WhenConfiguration } from '@when/config';

export function runCalendarList(config: WhenConfiguration): void {
	if (config.calendars.length === 0) {
		console.log('No calendars configured.');
		return;
	}
	for (const c of config.calendars) {
		console.log(`${c.name}  (${c.type})`);
	}
}
