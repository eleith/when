import { Temporal } from '@js-temporal/polyfill';

export type WizardStep = 1 | 2 | 3;

/** All slot instants across every date, flattened. */
export function flattenSlots(slotsByDate: Record<string, string[]>): string[] {
	return Object.values(slotsByDate).flat();
}

/** The set of `YYYY-MM-DD` keys that have at least one slot, in the given timezone. */
export function availableDates(slots: string[], tz: string): Set<string> {
	const dates = new Set<string>();
	for (const iso of slots) {
		dates.add(Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainDate().toString());
	}
	return dates;
}

/** Slots that fall on `dateKey` in the given timezone, sorted ascending. */
export function slotsOnDate(slots: string[], dateKey: string, tz: string): string[] {
	return slots
		.filter(
			(iso) =>
				Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainDate().toString() === dateKey
		)
		.sort();
}

/** Whether the wizard can move past the current step given what's been picked. */
export function canAdvance(
	step: WizardStep,
	viewDate: string | null,
	selectedSlot: string | null
): boolean {
	if (step === 1) return viewDate != null;
	if (step === 2) return selectedSlot != null;
	return true;
}
