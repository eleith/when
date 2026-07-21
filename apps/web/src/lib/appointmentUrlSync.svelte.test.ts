import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { createAppointmentFlow } from './appointmentFlow.svelte';

const m = vi.hoisted(() => ({
	page: { url: new URL('http://localhost/schedule/x'), state: {} },
	replaceState: vi.fn(),
	afterCb: { current: null as null | (() => void) }
}));

vi.mock('$app/state', () => ({ page: m.page }));
vi.mock('$app/navigation', () => ({
	afterNavigate: (cb: () => void) => {
		m.afterCb.current = cb;
	},
	replaceState: (...a: unknown[]) => m.replaceState(...a)
}));

import { createAppointmentUrlSync } from './appointmentUrlSync.svelte';

const SLOT = '2026-07-20T10:00:00Z';

function mkFlow() {
	const flow = createAppointmentFlow({
		slotsByDuration: { 30: { '2026-07-20': [SLOT] } },
		durations: [30],
		initialDuration: 30
	});
	flow.setTz('UTC');
	return flow;
}

function sync(flow: ReturnType<typeof mkFlow>) {
	return createAppointmentUrlSync(flow, { deepLink: true, tz: 'UTC', defaultDuration: 30 });
}

beforeEach(() => {
	vi.clearAllMocks();
	m.page.url = new URL('http://localhost/schedule/x');
	m.afterCb.current = null;
});

describe('createAppointmentUrlSync deep-link application', () => {
	it('selects an available deep-linked slot and jumps to the details step', () => {
		m.page.url = new URL(`http://localhost/schedule/x?slot=${SLOT}`);
		$effect.root(() => {
			const flow = mkFlow();
			sync(flow);
			expect(flow.selectedSlot).toBe(SLOT);
			expect(flow.step).toBe(3);
		})();
	});

	it('opens the day and notices an unavailable slot on an available day', () => {
		m.page.url = new URL('http://localhost/schedule/x?slot=2026-07-20T11:00:00Z');
		$effect.root(() => {
			const flow = mkFlow();
			const s = sync(flow);
			expect(flow.selectedSlot).toBeNull();
			expect(flow.viewDate).toBe('2026-07-20');
			expect(s.notice?.kind).toBe('slot');
		})();
	});

	it('notices an unavailable date without opening anything', () => {
		m.page.url = new URL('http://localhost/schedule/x?date=2030-01-01');
		$effect.root(() => {
			const flow = mkFlow();
			const s = sync(flow);
			expect(flow.viewDate).toBeNull();
			expect(s.notice?.kind).toBe('date');
		})();
	});
});

describe('createAppointmentUrlSync effects', () => {
	it('mirrors the flow position into the url once the router is ready', () => {
		$effect.root(() => {
			const flow = mkFlow();
			sync(flow);
			m.afterCb.current?.();
			flow.selectSlot(SLOT);
			flow.goToStep(3);
			flushSync();
			expect(m.replaceState).toHaveBeenCalledWith(
				expect.stringContaining(`slot=${encodeURIComponent(SLOT)}`),
				expect.anything()
			);
		})();
	});

	it('clears a slot notice once a slot is picked', () => {
		m.page.url = new URL('http://localhost/schedule/x?slot=2026-07-20T11:00:00Z');
		$effect.root(() => {
			const flow = mkFlow();
			const s = sync(flow);
			expect(s.notice?.kind).toBe('slot');
			flow.selectSlot(SLOT);
			flushSync();
			expect(s.notice).toBeNull();
		})();
	});
});
