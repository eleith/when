import {
	availableDates as datesFromSlots,
	canAdvance as canAdvanceRule,
	dateKeys,
	flattenSlots,
	type WizardStep
} from './appointment';
import { instantToDateKey } from './datetime';

export interface AppointmentFlow {
	readonly step: WizardStep;
	readonly viewDate: string | null;
	readonly selectedSlot: string | null;
	readonly userTz: string;
	readonly allSlots: string[];
	readonly availableDates: Set<string>;
	readonly offeredDates: Set<string>;
	readonly canAdvance: boolean;
	advance(): void;
	goBack(): void;
	goToStep(step: WizardStep): void;
	selectDate(dateKey: string | null): void;
	openDate(dateKey: string): void;
	selectSlot(iso: string): void;
	clearSlot(): void;
	setTz(tz: string): void;
}

/**
 * Single source of truth for the booking wizard: which step we're on, the
 * picked date/slot/timezone, and the rules for moving between steps. Created
 * once per page and handed to the picker components as a single `flow` prop, so
 * their selections flow back here without a `bind:` ladder.
 */
export function createAppointmentFlow(getSlotsByDate: () => Record<string, string[]>): AppointmentFlow {
	let step = $state<WizardStep>(1);
	let viewDate = $state<string | null>(null);
	let selectedSlot = $state<string | null>(null);
	let userTz = $state('UTC');

	const allSlots = $derived(flattenSlots(getSlotsByDate()));
	const dates = $derived(datesFromSlots(allSlots, userTz));
	// The raw server day keys (host tz), unlike `availableDates` which re-buckets in `userTz`.
	const offeredDates = $derived(dateKeys(getSlotsByDate()));
	const canAdvance = $derived(canAdvanceRule(step, viewDate, selectedSlot));

	function scrollToTop() {
		if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
	}

	return {
		get step() {
			return step;
		},
		get viewDate() {
			return viewDate;
		},
		get selectedSlot() {
			return selectedSlot;
		},
		get userTz() {
			return userTz;
		},
		get allSlots() {
			return allSlots;
		},
		get availableDates() {
			return dates;
		},
		get offeredDates() {
			return offeredDates;
		},
		get canAdvance() {
			return canAdvance;
		},
		advance() {
			if (!canAdvance || step === 3) return;
			step = (step + 1) as WizardStep;
			scrollToTop();
		},
		goBack() {
			if (step === 1) return;
			step = (step - 1) as WizardStep;
			scrollToTop();
		},
		goToStep(target) {
			step = target;
		},
		selectDate(dateKey) {
			if (dateKey == null) {
				viewDate = null;
				selectedSlot = null;
				return;
			}
			if (!dates.has(dateKey)) return;
			viewDate = dateKey;
			if (selectedSlot && !selectedSlot.startsWith(dateKey)) selectedSlot = null;
		},
		// Open the time picker on a day from a deep link, regardless of current availability —
		// the timeline shows that day's slots (or its empty state).
		openDate(dateKey) {
			viewDate = dateKey;
			selectedSlot = null;
			step = 2;
		},
		selectSlot(iso) {
			selectedSlot = iso;
			viewDate = instantToDateKey(iso, userTz);
		},
		clearSlot() {
			selectedSlot = null;
		},
		setTz(tz) {
			userTz = tz;
		}
	};
}
