import { page } from '$app/state';
import { goto, afterNavigate } from '$app/navigation';
import {
	resolveDeepLink,
	desiredUrlState,
	buildAppointmentSearch,
	urlStateMatches,
	type DeepLinkResult
} from './appointment';
import type { AppointmentFlow } from './appointmentFlow.svelte';

export interface AppointmentUrlSync {
	readonly notice: NonNullable<DeepLinkResult['notice']> | null;
}

/**
 * Wires the appointment flow to the URL, keeping the wizard declarative:
 * applies an incoming ?slot/?date deep link on load, exposes any "no longer
 * available" notice, and mirrors the flow position back into the query string
 * (canonical order, guarded against a re-encode loop). All the browser/router
 * coupling lives here. Call once during wizard init, after the viewer timezone
 * has been set on the flow so a deep-linked slot resolves to the right day.
 */
export function createAppointmentUrlSync(
	flow: AppointmentFlow,
	opts: { deepLink: boolean; tz: string; defaultDuration: number }
): AppointmentUrlSync {
	const result = resolveDeepLink({
		slotParam: page.url.searchParams.get('slot'),
		dateParam: page.url.searchParams.get('date'),
		allSlots: flow.allSlots,
		tz: opts.tz
	});

	let notice = $state<NonNullable<DeepLinkResult['notice']> | null>(result.notice ?? null);

	if (result.slot) {
		flow.selectSlot(result.slot);
		flow.goToStep(3);
	} else if (result.date) {
		flow.openDate(result.date);
	}

	let routerReady = $state(false);
	afterNavigate(() => {
		routerReady = true;
	});

	// Clear the notice once the guest moves past the unavailable slot/day.
	$effect(() => {
		if (!opts.deepLink || !notice) return;
		if (notice.kind === 'slot') {
			if (flow.selectedSlot || (flow.viewDate && flow.viewDate !== result.date)) notice = null;
		} else if (flow.viewDate) {
			notice = null;
		}
	});

	// Mirror the flow position into the URL, skipping the write when it already matches.
	$effect(() => {
		if (!routerReady || !opts.deepLink) return;
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
