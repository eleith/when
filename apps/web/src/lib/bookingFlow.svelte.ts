import {
	availableDates as datesFromSlots,
	canAdvance as canAdvanceRule,
	flattenSlots,
	type WizardStep
} from './booking';

export interface BookingFlow {
	readonly step: WizardStep;
	readonly viewDate: string | null;
	readonly selectedSlot: string | null;
	readonly userTz: string;
	readonly allSlots: string[];
	readonly availableDates: Set<string>;
	readonly canAdvance: boolean;
	advance(): void;
	goBack(): void;
	goToStep(step: WizardStep): void;
	selectDate(dateKey: string | null): void;
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
export function createBookingFlow(getSlotsByDate: () => Record<string, string[]>): BookingFlow {
	let step = $state<WizardStep>(1);
	let viewDate = $state<string | null>(null);
	let selectedSlot = $state<string | null>(null);
	let userTz = $state('UTC');

	const allSlots = $derived(flattenSlots(getSlotsByDate()));
	const dates = $derived(datesFromSlots(allSlots, userTz));
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
		selectSlot(iso) {
			selectedSlot = iso;
			viewDate = iso.slice(0, 10);
		},
		clearSlot() {
			selectedSlot = null;
		},
		setTz(tz) {
			userTz = tz;
		}
	};
}
