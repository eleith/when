import type { AvailabilityRule } from '@when/config';
import type { WeeklySchedule } from './types';

/**
 * Flatten the config's availability rules into per-weekday windows. Availability
 * is the union of all rules, so a weekday listed by several rules accumulates a
 * window from each. Empty/backwards windows (from >= to) are dropped defensively;
 * config validation already rejects them.
 */
export function expandWeekly(rules: AvailabilityRule[]): WeeklySchedule {
	const weekly: WeeklySchedule = {};
	for (const rule of rules) {
		if (rule.from >= rule.to) continue;
		for (const day of rule.days) {
			(weekly[day] ??= []).push({ from: rule.from, to: rule.to });
		}
	}
	return weekly;
}
