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

	it('steps back from the details step when the length drops the slot', () => {
		const flow = makeFlow();
		flow.selectSlot(SLOT_1030);
		flow.goToStep(3);
		flow.setDuration(60);
		expect(flow.step).toBe(2);
		expect(flow.selectedSlot).toBeNull();
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

	it('openDate jumps to the timeline and drops any slot', () => {
		const flow = makeFlow();
		flow.selectSlot(SLOT_10);
		flow.openDate('2026-07-20');
		expect(flow.viewDate).toBe('2026-07-20');
		expect(flow.selectedSlot).toBeNull();
		expect(flow.step).toBe(2);
	});

	it('selectSlot records the slot and derives the day from it', () => {
		const flow = makeFlow();
		flow.selectSlot(SLOT_1030);
		expect(flow.selectedSlot).toBe(SLOT_1030);
		expect(flow.viewDate).toBe('2026-07-20');
	});

	it('clearSlot drops the slot', () => {
		const flow = makeFlow();
		flow.selectSlot(SLOT_10);
		flow.clearSlot();
		expect(flow.selectedSlot).toBeNull();
	});

	it('re-buckets available dates when the timezone changes', () => {
		const flow = createAppointmentFlow({
			slotsByDuration: { 30: { '2026-07-20': ['2026-07-20T02:00:00Z'] } },
			durations: [30],
			initialDuration: 30
		});
		expect(flow.availableDates.has('2026-07-20')).toBe(true);
		flow.setTz('America/New_York');
		expect(flow.userTz).toBe('America/New_York');
		expect(flow.availableDates.has('2026-07-19')).toBe(true);
	});
});
