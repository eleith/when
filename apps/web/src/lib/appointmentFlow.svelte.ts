import * as browserInstantFns from 'temporal-polyfill/fns/Instant';
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
	readonly hasChanges: boolean;
	readonly originalStartUnavailable: boolean;
	readonly canSubmit: boolean;
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
	reschedule?: { start: string; duration: number };
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
	initialDuration,
	reschedule
}: AppointmentFlowInit): AppointmentFlow {
	const originalSlot = reschedule
		? browserInstantFns.toString(browserInstantFns.fromString(reschedule.start))
		: null;
	// A duration link behaves like changing length: retain the start only if it fits.
	// At the booked length, keep the original interval even if it is no longer offered.
	let initialSlot = originalSlot;
	if (
		reschedule &&
		originalSlot &&
		initialDuration !== reschedule.duration &&
		!flattenSlots(slotsByDuration[initialDuration] ?? {}).includes(originalSlot)
	) {
		initialSlot = null;
	}
	let step = $state<WizardStep>(1);
	let viewDate = $state<string | null>(originalSlot ? instantToDateKey(originalSlot, 'UTC') : null);
	let selectedSlot = $state<string | null>(initialSlot);
	let userTz = $state('UTC');
	let duration = $state(initialDuration);

	const slotsByDate = $derived(slotsByDuration[duration] ?? {});
	const allSlots = $derived(flattenSlots(slotsByDate));
	const dates = $derived(datesFromSlots(allSlots, userTz));
	const offeredDates = $derived(dateKeys(slotsByDate));
	const originalDate = $derived(originalSlot ? instantToDateKey(originalSlot, userTz) : null);
	const originalStartUnavailable = $derived(
		originalSlot !== null && selectedSlot === originalSlot && !allSlots.includes(originalSlot)
	);
	const intervalChanged = $derived(
		!reschedule || selectedSlot !== originalSlot || duration !== reschedule.duration
	);
	const hasChanges = $derived(intervalChanged || viewDate !== originalDate);
	const canSubmit = $derived(
		selectedSlot !== null && allSlots.includes(selectedSlot) && intervalChanged
	);
	const canAdvance = $derived.by(() => {
		if (reschedule) return true;
		if (step === 1) {
			if (viewDate === null) return false;
			return dates.has(viewDate);
		}
		return canAdvanceRule(step, viewDate, selectedSlot);
	});

	function clearUnavailableDateSelection() {
		if (step === 1 && viewDate && viewDate !== originalDate && !dates.has(viewDate)) {
			viewDate = null;
			selectedSlot = null;
		}
	}

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
		get hasChanges() {
			return hasChanges;
		},
		get originalStartUnavailable() {
			return originalStartUnavailable;
		},
		get canSubmit() {
			return canSubmit;
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
			clearUnavailableDateSelection();
			scrollToTop();
		},
		goToStep(target) {
			step = target;
			clearUnavailableDateSelection();
		},
		selectDate(dateKey) {
			if (dateKey == null) {
				viewDate = null;
				selectedSlot = null;
				return;
			}
			if (!dates.has(dateKey) && dateKey !== originalDate) return;
			viewDate = dateKey;
			if (selectedSlot && instantToDateKey(selectedSlot, userTz) !== dateKey) selectedSlot = null;
		},
		// Open the time picker on a day from a deep link, regardless of current availability —
		// the timeline shows that day's slots (or its empty state).
		openDate(dateKey) {
			viewDate = dateKey;
			if (selectedSlot && instantToDateKey(selectedSlot, userTz) !== dateKey) selectedSlot = null;
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
			const viewingOriginalDate = viewDate === originalDate;
			userTz = tz;
			if (selectedSlot) viewDate = instantToDateKey(selectedSlot, userTz);
			else if (viewingOriginalDate && originalSlot) {
				viewDate = instantToDateKey(originalSlot, userTz);
			}
			clearUnavailableDateSelection();
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
			clearUnavailableDateSelection();
		}
	};
}
