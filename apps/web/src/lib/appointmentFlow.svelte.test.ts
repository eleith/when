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
