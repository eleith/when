import { describe, it, expect } from 'vitest';
import { createAppointmentFlow, type AppointmentFlowInit } from './appointmentFlow.svelte';

const SLOT_10 = '2026-07-20T10:00:00Z';
const SLOT_1030 = '2026-07-20T10:30:00Z';

// 10:30 only exists at the 30-minute length; the 60-minute length drops it.
const slotsByDuration = {
	30: { '2026-07-20': [SLOT_10, SLOT_1030] },
	60: { '2026-07-20': [SLOT_10] }
};

function makeFlow(overrides: Partial<AppointmentFlowInit> = {}) {
	return createAppointmentFlow({
		slotsByDuration,
		durations: [30, 60],
		initialDuration: 30,
		...overrides
	});
}

describe('createAppointmentFlow duration', () => {
	it('exposes the initial duration and the list', () => {
		const flow = makeFlow();
		expect(flow.duration).toBe(30);
		expect(flow.durations).toEqual([30, 60]);
		expect(flow.allSlots).toEqual([SLOT_10, SLOT_1030]);
	});

	it('switches the live slot map when the length changes', () => {
		const flow = makeFlow();
		flow.setDuration(60);
		expect(flow.duration).toBe(60);
		expect(flow.allSlots).toEqual([SLOT_10]);
	});

	it('ignores an unknown length', () => {
		const flow = makeFlow();
		flow.setDuration(45);
		expect(flow.duration).toBe(30);
	});

	it('ignores re-selecting the current length', () => {
		const flow = makeFlow();
		flow.selectSlot(SLOT_1030);
		flow.setDuration(30);
		expect(flow.selectedSlot).toBe(SLOT_1030);
	});

	it('clears a selected slot that no longer exists at the new length', () => {
		const flow = makeFlow();
		flow.selectSlot(SLOT_1030);
		flow.setDuration(60);
		expect(flow.selectedSlot).toBeNull();
	});

	it('keeps a selected slot that still exists at the new length', () => {
		const flow = makeFlow();
		flow.selectSlot(SLOT_10);
		flow.setDuration(60);
		expect(flow.selectedSlot).toBe(SLOT_10);
	});

	it('clears a day that no longer offers the new duration and prevents continuing', () => {
		const flow = makeFlow({
			slotsByDuration: {
				30: { '2026-07-20': [SLOT_10], '2026-07-21': ['2026-07-21T10:00:00Z'] },
				60: { '2026-07-21': ['2026-07-21T10:00:00Z'] }
			}
		});
		flow.selectDate('2026-07-20');
		flow.setDuration(60);
		expect(flow.availableDates.has('2026-07-21')).toBe(true);
		expect(flow.viewDate).toBeNull();
		expect(flow.canAdvance).toBe(false);
		flow.advance();
		expect(flow.step).toBe(1);
	});

	it('preserves a day that still offers the new duration', () => {
		const flow = makeFlow();
		flow.selectDate('2026-07-20');
		flow.setDuration(60);
		expect(flow.viewDate).toBe('2026-07-20');
		expect(flow.canAdvance).toBe(true);
	});

	it('keeps an empty time-picker day for recovery but clears it when returning to the calendar', () => {
		const flow = makeFlow({
			slotsByDuration: {
				30: { '2026-07-20': [SLOT_10], '2026-07-21': ['2026-07-21T10:00:00Z'] },
				60: { '2026-07-21': ['2026-07-21T10:00:00Z'] }
			}
		});
		flow.openDate('2026-07-20');
		flow.selectSlot(SLOT_10);
		flow.setDuration(60);
		expect(flow.step).toBe(2);
		expect(flow.viewDate).toBe('2026-07-20');
		expect(flow.selectedSlot).toBeNull();
		expect(flow.canAdvance).toBe(false);
		flow.goBack();
		expect(flow.step).toBe(1);
		expect(flow.viewDate).toBeNull();
		expect(flow.canAdvance).toBe(false);
	});

	it('steps back from the details step when the length drops the slot', () => {
		const flow = makeFlow();
		flow.selectSlot(SLOT_1030);
		flow.goToStep(3);
		flow.setDuration(60);
		expect(flow.step).toBe(2);
		expect(flow.selectedSlot).toBeNull();
	});
});

describe('createAppointmentFlow rescheduling', () => {
	it('normalizes the original instant and starts on the calendar with navigation allowed but no-op submission blocked', () => {
		const flow = makeFlow({
			reschedule: { start: '2026-07-20T10:00:00.000Z', duration: 30 }
		});
		expect(flow.step).toBe(1);
		expect(flow.viewDate).toBe('2026-07-20');
		expect(flow.selectedSlot).toBe(SLOT_10);
		expect(flow.hasChanges).toBe(false);
		expect(flow.canAdvance).toBe(true);
		expect(flow.canSubmit).toBe(false);
		flow.advance();
		expect(flow.step).toBe(2);
		expect(flow.canAdvance).toBe(true);
		flow.advance();
		expect(flow.step).toBe(3);
		expect(flow.canSubmit).toBe(false);
		flow.goBack();
		flow.goToStep(3);
		expect(flow.step).toBe(3);
		expect(flow.selectedSlot).toBe(SLOT_10);
		expect(flow.hasChanges).toBe(false);
		expect(flow.canSubmit).toBe(false);
	});

	it('retains a fitting start across length changes and blocks only submission when the booked length is restored', () => {
		const flow = makeFlow({
			initialDuration: 60,
			reschedule: { start: SLOT_10, duration: 60 }
		});
		flow.setDuration(30);
		expect(flow.step).toBe(1);
		expect(flow.duration).toBe(30);
		expect(flow.selectedSlot).toBe(SLOT_10);
		expect(flow.hasChanges).toBe(true);
		expect(flow.canAdvance).toBe(true);
		expect(flow.canSubmit).toBe(true);
		flow.advance();
		flow.advance();
		expect(flow.step).toBe(3);
		expect(flow.canSubmit).toBe(true);
		flow.setDuration(60);
		expect(flow.duration).toBe(60);
		expect(flow.selectedSlot).toBe(SLOT_10);
		expect(flow.hasChanges).toBe(false);
		expect(flow.canAdvance).toBe(true);
		expect(flow.canSubmit).toBe(false);
		flow.goBack();
		expect(flow.step).toBe(2);
		flow.advance();
		expect(flow.step).toBe(3);
		expect(flow.canSubmit).toBe(false);
	});

	it('allows navigation through unoffered original context and partial day or duration changes without allowing submission', () => {
		const original = '2026-07-20T11:30:00Z';
		const flow = makeFlow({
			slotsByDuration: {
				30: { '2026-07-20': [original], '2026-07-21': ['2026-07-21T11:30:00Z'] },
				60: { '2026-07-20': [SLOT_10], '2026-07-21': ['2026-07-21T11:30:00Z'] }
			},
			initialDuration: 60,
			reschedule: { start: '2026-07-20T11:30:00.000Z', duration: 60 }
		});
		flow.setTz('Pacific/Kiritimati');
		expect(flow.step).toBe(1);
		expect(flow.viewDate).toBe('2026-07-21');
		expect(flow.selectedSlot).toBe(original);
		expect(flow.allSlots).not.toContain(original);
		expect(flow.hasChanges).toBe(false);
		expect(flow.canAdvance).toBe(true);
		expect(flow.canSubmit).toBe(false);
		flow.advance();
		expect(flow.step).toBe(2);
		flow.advance();
		expect(flow.step).toBe(3);
		expect(flow.canSubmit).toBe(false);

		flow.goBack();
		flow.setDuration(30);
		expect(flow.selectedSlot).toBe(original);
		expect(flow.hasChanges).toBe(true);
		expect(flow.canSubmit).toBe(true);
		flow.goBack();
		expect(flow.viewDate).toBe('2026-07-21');
		flow.selectDate('2026-07-22');
		expect(flow.viewDate).toBe('2026-07-22');
		expect(flow.selectedSlot).toBeNull();
		expect(flow.hasChanges).toBe(true);
		expect(flow.canAdvance).toBe(true);
		expect(flow.canSubmit).toBe(false);
		flow.setDuration(60);
		expect(flow.duration).toBe(60);
		expect(flow.viewDate).toBe('2026-07-22');
		expect(flow.selectedSlot).toBeNull();
		expect(flow.hasChanges).toBe(true);
		expect(flow.canAdvance).toBe(true);
		expect(flow.canSubmit).toBe(false);
		flow.advance();
		expect(flow.step).toBe(2);
		flow.advance();
		expect(flow.step).toBe(3);
		expect(flow.canSubmit).toBe(false);
		flow.openDate('2026-07-21');
		expect(flow.viewDate).toBe('2026-07-21');
		expect(flow.selectedSlot).toBeNull();
		flow.setDuration(30);
		expect(flow.hasChanges).toBe(true);
		expect(flow.canAdvance).toBe(true);
		expect(flow.canSubmit).toBe(false);
	});
});

describe('createAppointmentFlow navigation', () => {
	it('blocks advancing from step 1 until a date is in view', () => {
		const flow = makeFlow();
		flow.advance();
		expect(flow.step).toBe(1);
		flow.selectDate('2026-07-20');
		flow.advance();
		expect(flow.step).toBe(2);
	});

	it('blocks advancing from step 2 until a slot is picked', () => {
		const flow = makeFlow();
		flow.selectDate('2026-07-20');
		flow.advance();
		flow.advance();
		expect(flow.step).toBe(2);
		flow.selectSlot(SLOT_10);
		flow.advance();
		expect(flow.step).toBe(3);
	});

	it('does not advance past step 3', () => {
		const flow = makeFlow();
		flow.goToStep(3);
		flow.advance();
		expect(flow.step).toBe(3);
	});

	it('goes back a step but not before step 1', () => {
		const flow = makeFlow();
		flow.goBack();
		expect(flow.step).toBe(1);
		flow.goToStep(2);
		flow.goBack();
		expect(flow.step).toBe(1);
	});
});

describe('createAppointmentFlow selection', () => {
	it('selectDate(null) clears the date and slot', () => {
		const flow = makeFlow();
		flow.selectSlot(SLOT_10);
		flow.selectDate(null);
		expect(flow.viewDate).toBeNull();
		expect(flow.selectedSlot).toBeNull();
	});

	it('ignores selecting a date that is not offered', () => {
		const flow = makeFlow();
		flow.selectDate('2000-01-01');
		expect(flow.viewDate).toBeNull();
	});

	it('clears a selected slot when switching to a different day', () => {
		const flow = createAppointmentFlow({
			slotsByDuration: {
				30: { '2026-07-20': [SLOT_10], '2026-07-21': ['2026-07-21T10:00:00Z'] }
			},
			durations: [30],
			initialDuration: 30
		});
		flow.selectSlot(SLOT_10);
		flow.selectDate('2026-07-21');
		expect(flow.viewDate).toBe('2026-07-21');
		expect(flow.selectedSlot).toBeNull();
	});

	it('openDate preserves a slot on the viewed day and drops it on another day', () => {
		const flow = makeFlow();
		flow.selectSlot(SLOT_10);
		flow.openDate('2026-07-20');
		expect(flow.viewDate).toBe('2026-07-20');
		expect(flow.selectedSlot).toBe(SLOT_10);
		expect(flow.step).toBe(2);
		flow.openDate('2026-07-21');
		expect(flow.selectedSlot).toBeNull();
	});

	it('keeps the selected instant and updates its day when the timezone changes', () => {
		const flow = makeFlow();
		flow.selectSlot(SLOT_1030);
		expect(flow.selectedSlot).toBe(SLOT_1030);
		expect(flow.viewDate).toBe('2026-07-20');
		flow.setTz('Pacific/Kiritimati');
		expect(flow.selectedSlot).toBe(SLOT_1030);
		expect(flow.viewDate).toBe('2026-07-21');
		expect(flow.canAdvance).toBe(true);
	});

	it('clearSlot drops the slot', () => {
		const flow = makeFlow();
		flow.selectSlot(SLOT_10);
		flow.clearSlot();
		expect(flow.selectedSlot).toBeNull();
	});

	it('re-buckets available dates and clears an unavailable calendar selection when the timezone changes', () => {
		const flow = createAppointmentFlow({
			slotsByDuration: { 30: { '2026-07-20': ['2026-07-20T02:00:00Z'] } },
			durations: [30],
			initialDuration: 30
		});
		flow.selectDate('2026-07-20');
		expect(flow.canAdvance).toBe(true);
		flow.setTz('America/New_York');
		expect(flow.userTz).toBe('America/New_York');
		expect(flow.availableDates.has('2026-07-19')).toBe(true);
		expect(flow.availableDates.has('2026-07-20')).toBe(false);
		expect(flow.viewDate).toBeNull();
		expect(flow.canAdvance).toBe(false);
	});
});
