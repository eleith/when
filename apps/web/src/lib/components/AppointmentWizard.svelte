<script lang="ts">
	import { page } from '$app/state';
	import { replaceState, afterNavigate } from '$app/navigation';
	import DatePicker from '$lib/components/DatePicker.svelte';
	import DayTimeline from '$lib/components/DayTimeline.svelte';
	import DurationPrompt from '$lib/components/DurationPrompt.svelte';
	import CalendarSkeleton from '$lib/components/CalendarSkeleton.svelte';
	import TimelineSkeleton from '$lib/components/TimelineSkeleton.svelte';
	import RescheduleBanner from '$lib/components/RescheduleBanner.svelte';
	import LinkNotice from '$lib/components/LinkNotice.svelte';
	import WizardContext from '$lib/components/WizardContext.svelte';
	import WizardActions from '$lib/components/WizardActions.svelte';
	import GuestForm from '$lib/components/GuestForm.svelte';
	import { createAppointmentFlow } from '$lib/appointmentFlow.svelte';
	import { resolveDeepLink, buildDayTimeline, type DeepLinkResult } from '$lib/appointment';
	import { getPreferredTimezone } from '$lib/preferredTimezone.svelte';
	import type { GuestAnswer, Appearance, FormField } from '@when/config';
	import type { PublicEventType } from '$lib/server/appointment/sanitize';

	// Shared shape served by both the new-appointment route and the reschedule route.
	export interface AppointmentWizardData {
		user: {
			name: string;
			timezone: string;
			appearance: Appearance;
		};
		eventType: PublicEventType;
		formFields: readonly FormField[];
		slotsByDuration: Record<number, Record<string, string[]>>;
		workingWindows: { start: string; end: string }[];
		busyBlocks: { start: string; end: string }[];
		rescheduleAppt: {
			id: string;
			start_time: string;
			end_time: string;
			guest_name: string;
			guest_email: string | null;
			answers: GuestAnswer[];
			location: string | null;
		} | null;
		rescheduleError: string | null;
		rescheduleToken: string | null;
		isAdmin: boolean;
	}

	interface Props {
		data: AppointmentWizardData;
		form: { error?: string; fieldErrors?: Record<string, string> } | null;
		deepLink?: boolean;
	}

	let { data, form, deepLink = false }: Props = $props();

	const durationParam = Number(page.url.searchParams.get('duration'));
	// svelte-ignore state_referenced_locally
	const durations = data.eventType.durations;
	// svelte-ignore state_referenced_locally
	const slotsByDuration = data.slotsByDuration;
	const initialDuration = durations.includes(durationParam) ? durationParam : durations[0];

	const flow = createAppointmentFlow({ slotsByDuration, durations, initialDuration });
	const ptz = getPreferredTimezone();

	let step = $derived(flow.step);
	let viewDate = $derived(flow.viewDate);
	let selectedSlot = $derived(flow.selectedSlot);
	let userTz = $derived(flow.userTz);

	const activeEventType = $derived({ ...data.eventType, duration_minutes: flow.duration });

	let formAction = $derived.by(() => {
		if (data.isAdmin) {
			if (data.rescheduleAppt) {
				return `/admin/appointment/${data.rescheduleAppt.id}/reschedule?/book`;
			} else {
				return `/admin/schedule/${data.eventType.slug}?/book`;
			}
		}
		return '?/book';
	});

	let previousAppointmentHref = $derived(
		data.rescheduleAppt
			? `/appointment/${data.rescheduleAppt.id}?token=${encodeURIComponent(data.rescheduleToken || '')}`
			: ''
	);

	let timelineSkeletonRows = $derived.by(() => {
		if (step !== 2 || !viewDate) return 0;
		const t = buildDayTimeline({
			viewDate,
			workingWindows: data.workingWindows,
			busyBlocks: data.busyBlocks,
			eventType: activeEventType,
			daySlots: [],
			tz: data.user.timezone
		});
		return t ? Math.round(t.totalMs / 3600000) : 0;
	});

	let routerReady = $state(false);
	let linkNotice = $state<NonNullable<DeepLinkResult['notice']> | null>(null);

	let fieldsDisabled = $derived(data.isAdmin && !!data.rescheduleAppt);

	const initialSlot = page.url.searchParams.get('slot');
	const initialDate = page.url.searchParams.get('date');

	// Resolved before render so SSR lands on the right step.
	// svelte-ignore state_referenced_locally
	const deepLinkResult = resolveDeepLink({
		slotParam: initialSlot,
		dateParam: initialDate,
		allSlots: flow.allSlots,
		tz: ptz.current ?? data.user.timezone
	});
	if (ptz.current) flow.setTz(ptz.current);
	if (deepLinkResult.notice) {
		linkNotice = deepLinkResult.notice;
	}
	if (deepLinkResult.slot) {
		flow.selectSlot(deepLinkResult.slot);
		flow.goToStep(3);
	} else if (deepLinkResult.date) {
		flow.openDate(deepLinkResult.date);
	}

	$effect(() => {
		if (!ptz.current) return;
		flow.setTz(ptz.current);
		if (flow.selectedSlot) flow.selectSlot(flow.selectedSlot);
	});

	afterNavigate(() => {
		routerReady = true;
	});

	$effect(() => {
		if (!deepLink) return;
		if (linkNotice) {
			if (linkNotice.kind === 'slot') {
				// Clear slot notice if they select any slot, or if they navigate to a different day
				if (selectedSlot || (viewDate && viewDate !== deepLinkResult.date)) {
					linkNotice = null;
				}
			} else {
				// Clear date notice if they select any day
				if (viewDate) {
					linkNotice = null;
				}
			}
		}
	});

	$effect(() => {
		if (!routerReady) return;
		if (!deepLink) return;

		const desiredDuration = flow.duration === durations[0] ? null : String(flow.duration);
		let desiredSlot: string | null = null;
		let desiredDate: string | null = null;
		if (flow.step === 3 && flow.selectedSlot) {
			desiredSlot = flow.selectedSlot;
		} else if (flow.viewDate) {
			desiredDate = flow.viewDate;
		}

		// Compare decoded values, not the encoded search string, so re-encoding can't loop.
		if (
			page.url.searchParams.get('duration') === desiredDuration &&
			page.url.searchParams.get('slot') === desiredSlot &&
			page.url.searchParams.get('date') === desiredDate
		) {
			return;
		}

		// Canonical order matches the server load: duration, then slot or date.
		const parts: string[] = [];
		if (desiredDuration) parts.push(`duration=${desiredDuration}`);
		if (desiredSlot) parts.push(`slot=${encodeURIComponent(desiredSlot)}`);
		else if (desiredDate) parts.push(`date=${encodeURIComponent(desiredDate)}`);
		const search = parts.length ? `?${parts.join('&')}` : '';

		replaceState(`${page.url.pathname}${search}`, page.state);
	});
</script>

<svelte:head>
	<title>{data.eventType.name} — {data.user.name}</title>
</svelte:head>

<header class="page-banner">
	<a href="/" class="banner-link">
		{#if data.user.appearance.avatar_url}
			<img src={data.user.appearance.avatar_url} alt={data.user.name} class="banner-avatar" />
		{/if}
		<div class="banner-text">
			<span class="banner-title">{data.user.appearance.title}</span>
			<div class="banner-desc">{data.user.appearance.description}</div>
		</div>
	</a>
	<div class="banner-event">
		<h1 class="banner-event-name">{data.eventType.name}</h1>
		{#if data.eventType.description}
			<p class="banner-event-meta">{data.eventType.description}</p>
		{/if}
	</div>
</header>

<main class="appointment">
	{#if data.rescheduleError}
		<div class="card reschedule-error-card">
			<h1 class="error-title">Can't reschedule this appointment</h1>
			<p class="error-reason">
				{#if data.rescheduleError === 'token'}
					This link doesn't match an appointment. Check your email for the latest reschedule link.
				{:else if data.rescheduleError === 'event_type'}
					This appointment's event type no longer exists.
				{:else if data.rescheduleError === 'past_window'}
					This appointment is too old to reschedule.
				{:else if data.rescheduleError === 'terminal'}
					This appointment has already been cancelled or declined.
				{:else if data.rescheduleError === 'minimum_notice'}
					It's too close to the start time to reschedule.
				{/if}
			</p>
			<a class="error-back-btn" href="/">Return home</a>
		</div>
	{:else if flow.availableDates.size === 0}
		<p class="empty">No availability in the near future.</p>
	{:else}
		{#if data.rescheduleAppt}
			<RescheduleBanner
				previousHref={previousAppointmentHref}
				startTime={data.rescheduleAppt.start_time}
				tz={userTz}
			/>
		{/if}

		{#if linkNotice && (step === 1 || linkNotice.kind === 'slot')}
			<LinkNotice notice={linkNotice} tz={userTz} />
		{/if}

		<div class="card">
			<WizardContext
				appearance={data.user.appearance}
				providerName={data.user.name}
				eventName={data.eventType.name}
				eventDescription={data.eventType.description}
				{step}
			/>

			<div class="card-stage">
				<div class="appointment-body">
					{#if step === 1}
						{#if ptz.current}
							<DatePicker {flow} />
						{:else}
							<CalendarSkeleton />
						{/if}
					{:else if step === 2}
						{#if ptz.current}
							<DayTimeline
								{flow}
								workingWindows={data.workingWindows}
								busyBlocks={data.busyBlocks}
								eventType={activeEventType}
								bookingStyle={data.eventType.booking_style}
								originalSlot={data.rescheduleAppt?.start_time ?? null}
								onEditDate={flow.goBack}
							>
								{#snippet beforeSlots()}
									<DurationPrompt {durations} value={flow.duration} onSelect={flow.setDuration} />
								{/snippet}
							</DayTimeline>
						{:else}
							<TimelineSkeleton rows={timelineSkeletonRows} />
						{/if}
					{/if}

					{#if step === 3 && selectedSlot}
						<GuestForm
							formFields={data.formFields}
							rescheduleAppt={data.rescheduleAppt}
							rescheduleToken={data.rescheduleToken}
							{fieldsDisabled}
							{form}
							{formAction}
							{selectedSlot}
							{viewDate}
							{userTz}
							duration={flow.duration}
							bookingApproval={data.eventType.booking_approval}
							onBack={flow.goBack}
						/>
					{/if}
				</div>

				<WizardActions
					{step}
					{viewDate}
					{selectedSlot}
					{userTz}
					canAdvance={flow.canAdvance}
					isReschedule={!!data.rescheduleAppt}
					bookingApproval={data.eventType.booking_approval}
					onAdvance={flow.advance}
					onBack={flow.goBack}
				/>
			</div>
		</div>
	{/if}
</main>

<style>
	.appointment {
		max-width: 960px;
		margin: 0 auto;
		padding: var(--space-8) var(--space-6) var(--space-10);
		color: var(--text);
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: var(--space-9) 0;
	}

	/* ---- card layout ---- */
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		display: flex;
		overflow: hidden;
		min-height: 520px;
	}

	.card-stage {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		padding: var(--space-7);
	}

	.appointment-body {
		flex: 1;
		min-height: 0;
	}

	/* ---- page banner (full-width) ---- */
	.page-banner {
		width: 100%;
		border-bottom: 1px solid var(--border);
		padding: var(--space-5) var(--space-7);
		display: flex;
		align-items: center;
		gap: var(--space-5);
	}

	.banner-link {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		text-decoration: none;
		color: inherit;
		flex: 1;
		max-width: 960px;
		min-width: 0;
	}

	.banner-event {
		display: none;
		flex: 1;
		min-width: 0;
	}

	.banner-event-name {
		font-size: var(--font-size-md);
		font-weight: 700;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.banner-event-meta {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		margin: var(--space-1) 0 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.banner-link:hover .banner-title {
		opacity: 0.8;
	}

	.banner-avatar {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
	}

	.banner-text {
		min-width: 0;
	}

	.banner-title {
		font-size: var(--font-size-md);
		font-weight: 700;
		transition: opacity var(--transition);
	}

	.banner-desc {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		margin-top: var(--space-1);
	}

	.banner-desc :global(p) {
		margin: 0;
	}

	/* ---- desktop-only: hide page banner (provider info moved to sidebar) ---- */
	@media (min-width: 769px) {
		.page-banner {
			display: none;
		}
	}

	/* ---- responsive ---- */
	@media (max-width: 768px) {
		.page-banner {
			padding: var(--space-4) var(--space-5);
		}

		.banner-link {
			flex: 0 0 auto;
		}

		.banner-text {
			display: none;
		}

		.banner-event {
			display: block;
		}

		.appointment {
			padding: var(--space-5) var(--space-5) calc(var(--space-9) + 64px);
		}

		.card {
			background: transparent;
			border: none;
			border-radius: 0;
			min-height: 0;
			display: block;
		}

		.card-stage {
			padding: 0;
		}

		.appointment :global(.timeline-scroll) {
			max-height: none;
			overflow: visible;
		}
	}

	.reschedule-error-card {
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-8);
		text-align: center;
		min-height: 320px;
		width: 100%;
		gap: var(--space-4);
	}

	.error-title {
		font-size: var(--font-size-2xl);
		font-weight: 700;
		margin: 0 0 var(--space-2);
	}

	.error-reason {
		color: var(--text-muted);
		font-size: var(--font-size-md);
		line-height: 1.5;
		margin: 0 0 var(--space-4);
		max-width: 480px;
	}

	.error-back-btn {
		display: inline-flex;
		align-items: center;
		padding: var(--space-3) var(--space-6);
		background: var(--primary);
		color: var(--text-on-primary);
		border-radius: var(--radius);
		font-weight: 600;
		text-decoration: none;
		transition: opacity var(--transition);
	}

	.error-back-btn:hover {
		opacity: 0.9;
	}
</style>
