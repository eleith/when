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
	readonly duration: number;
	readonly durations: number[];
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
	setDuration(minutes: number): void;
}

export interface AppointmentFlowInit {
	slotsByDuration: Record<number, Record<string, string[]>>;
	durations: number[];
	initialDuration: number;
}

/**
 * Single source of truth for the appointment wizard: which step we're on, the
 * picked date/slot/timezone/length, and the rules for moving between steps.
 * Created once per page and handed to the picker components as a single `flow`
 * prop, so their selections flow back here without a `bind:` ladder. The chosen
 * duration selects which day/slot map is live, so it lives here too.
 */
export function createAppointmentFlow({
	slotsByDuration,
	durations,
	initialDuration
}: AppointmentFlowInit): AppointmentFlow {
	let step = $state<WizardStep>(1);
	let viewDate = $state<string | null>(null);
	let selectedSlot = $state<string | null>(null);
	let userTz = $state('UTC');
	let duration = $state(initialDuration);

	const slotsByDate = $derived(slotsByDuration[duration] ?? {});
	const allSlots = $derived(flattenSlots(slotsByDate));
	const dates = $derived(datesFromSlots(allSlots, userTz));
	// The raw server day keys (host tz), unlike `availableDates` which re-buckets in `userTz`.
	const offeredDates = $derived(dateKeys(slotsByDate));
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
		get duration() {
			return duration;
		},
		get durations() {
			return durations;
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
		},
		// Changing the length swaps the live slot map. If the picked time no longer
		// exists at the new length, drop it and step back so the guest re-picks.
		setDuration(minutes) {
			if (minutes === duration || !durations.includes(minutes)) return;
			duration = minutes;
			if (selectedSlot && !flattenSlots(slotsByDuration[minutes] ?? {}).includes(selectedSlot)) {
				selectedSlot = null;
				if (step === 3) step = 2;
			}
		}
	};
}
