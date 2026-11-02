import * as InstantFns from 'temporal-polyfill/fns/Instant';
import { untrack } from 'svelte';
import { page } from '$app/state';
import { goto, afterNavigate } from '$app/navigation';
import {
	resolveDeepLink,
	desiredUrlState,
	buildAppointmentSearch,
	urlStateMatches,
	type DeepLinkResult
} from './appointment';
import { instantToDateKey } from './datetime';
import type { AppointmentFlow, AppointmentFlowInit } from './appointmentFlow.svelte';

export interface AppointmentUrlSync {
	readonly notice: NonNullable<DeepLinkResult['notice']> | null;
}

/** Applies the incoming link once the viewer timezone is known, then mirrors flow state. */
export function createAppointmentUrlSync(
	flow: AppointmentFlow,
	opts: {
		deepLink: boolean;
		initialTimezone: string;
		timezone: () => string | null;
		defaultDuration: number;
		reschedule?: AppointmentFlowInit['reschedule'];
	}
): AppointmentUrlSync {
	const slotParam = page.url.searchParams.get('slot');
	const dateParam = page.url.searchParams.get('date');
	let notice = $state<NonNullable<DeepLinkResult['notice']> | null>(null);
	let requestedDate: string | undefined;
	let linkApplied = $state(false);
	flow.setTz(opts.initialTimezone);

	function resolveIncomingLink(tz: string) {
		let result = resolveDeepLink({ slotParam, dateParam, allSlots: flow.allSlots, tz });

		// The current interval is context, not an extra offered slot.
		if (opts.reschedule) {
			const originalSlot = InstantFns.toString(InstantFns.fromString(opts.reschedule.start));
			const originalDate = instantToDateKey(originalSlot, tz);
			let requestedSlot = result.slot;
			if (!requestedSlot && result.notice?.kind === 'slot') {
				requestedSlot = result.notice.requested;
			}
			if (requestedSlot === originalSlot && flow.duration === opts.reschedule.duration) {
				result = { step: 1, slot: originalSlot };
			} else if (result.notice?.kind === 'date' && result.notice.requested === originalDate) {
				result = { step: 2, date: originalDate };
			}
		}
		return result;
	}

	function applyLink(tz: string) {
		const result = resolveIncomingLink(tz);
		notice = result.notice ?? null;
		requestedDate = result.date;
		if (notice) {
			flow.clearSlot();
			if (!result.date) {
				flow.selectDate(null);
				flow.goToStep(1);
			}
		}
		if (result.slot) {
			flow.selectSlot(result.slot);
			flow.goToStep(result.step);
		} else if (result.date) {
			flow.openDate(result.date);
		}
	}

	const initialTimezone = opts.timezone();
	if (initialTimezone) {
		flow.setTz(initialTimezone);
		applyLink(initialTimezone);
		linkApplied = true;
	}

	$effect(() => {
		const tz = opts.timezone();
		if (!tz) return;
		untrack(() => {
			flow.setTz(tz);
			if (linkApplied) return;
			applyLink(tz);
			linkApplied = true;
		});
	});

	let routerReady = $state(false);
	afterNavigate(() => {
		routerReady = true;
	});

	$effect(() => {
		if (!notice) return;
		if (notice.kind === 'slot') {
			if (flow.selectedSlot || (flow.viewDate && flow.viewDate !== requestedDate)) notice = null;
		} else if (flow.viewDate) {
			notice = null;
		}
	});

	$effect(() => {
		if (!routerReady || !linkApplied || !opts.deepLink) return;
		const desired = desiredUrlState({
			duration: flow.duration,
			defaultDuration: opts.defaultDuration,
			step: flow.step,
			selectedSlot: flow.selectedSlot,
			viewDate: flow.viewDate
		});
		// Shallow navigation changes page.shallow, not the last fully loaded page.url.
		const url = page.shallow?.url ?? page.url;
		if (urlStateMatches(url.searchParams, desired)) return;
		void goto(`${url.pathname}${buildAppointmentSearch(desired)}`, {
			shallow: true,
			replace: true,
			state: page.state
		}).catch((error) => console.error('Failed to synchronize booking URL', error));
	});

	return {
		get notice() {
			return notice;
		}
	};
}
