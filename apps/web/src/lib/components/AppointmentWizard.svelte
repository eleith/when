<script lang="ts">
	import { page } from '$app/state';
	import { replaceState, afterNavigate } from '$app/navigation';
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import IconInfo from 'virtual:icons/ph/info';
	import DatePicker from '$lib/components/DatePicker.svelte';
	import DayTimeline from '$lib/components/DayTimeline.svelte';
	import { createAppointmentFlow } from '$lib/appointmentFlow.svelte';
	import { resolveDeepLink, buildDayTimeline, type DeepLinkResult } from '$lib/appointment';
	import {
		formatDate,
		formatDateCompact,
		formatTime,
		formatTimeShort,
		formatSlot,
		formatTzAbbrev
	} from '$lib/datetime';
	import { getPreferredTimezone } from '$lib/preferredTimezone.svelte';
	import type { AttendeeAnswer, Branding, FormField, Location } from '@when/config';

	// Shared shape served by both the new-appointment route and the reschedule route.
	export interface AppointmentWizardData {
		user: {
			name: string;
			timezone: string;
			branding: (Branding & { descriptionHtml: string | Promise<string> | null }) | null;
		};
		eventType: {
			id: string;
			name: string;
			slug: string;
			duration: number;
			description: string | null;
			visibility: 'public' | 'private';
			appointment_flow: 'auto' | 'requires_confirmation';
			location: Location | null;
			buffer_before?: number;
			buffer_after?: number;
			minimum_notice?: number;
		};
		formFields: readonly FormField[];
		slotsByDate: Record<string, string[]>;
		workingWindows: { start: string; end: string }[];
		busyBlocks: { start: string; end: string }[];
		rescheduleAppt: {
			id: string;
			start_time: string;
			end_time: string;
			attendee_name: string;
			attendee_email: string | null;
			answers: AttendeeAnswer[];
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

	const flow = createAppointmentFlow(() => data.slotsByDate);
	const ptz = getPreferredTimezone();

	let step = $derived(flow.step);
	let viewDate = $derived(flow.viewDate);
	let selectedSlot = $derived(flow.selectedSlot);
	let userTz = $derived(flow.userTz);

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
			eventType: data.eventType,
			daySlots: [],
			tz: data.user.timezone
		});
		return t ? Math.round(t.totalMs / 3600000) : 0;
	});

	let routerReady = $state(false);
	let nameInput = $state<HTMLInputElement | null>(null);
	let linkNotice = $state<NonNullable<DeepLinkResult['notice']> | null>(null);

	// svelte-ignore state_referenced_locally
	const priorAnswers = data.rescheduleAppt?.answers ?? [];

	function initialFieldValue(field: FormField): string {
		const r = data.rescheduleAppt;
		if (!r) return '';
		if (field.type === 'attendee_name') return r.attendee_name ?? '';
		if (field.type === 'attendee_email') return r.attendee_email ?? '';
		if (field.type === 'event_location') return r.location ?? '';
		return priorAnswers.find((a) => a.id === field.id)?.value ?? '';
	}

	// svelte-ignore state_referenced_locally
	let paragraphValues = $state<Record<string, string>>(
		Object.fromEntries(
			data.formFields.filter((f) => f.type === 'paragraph').map((f) => [f.id, initialFieldValue(f)])
		)
	);

	let rescheduleReasonValue = $state('');

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
		if (step === 3 && selectedSlot) {
			nameInput?.focus();
		}
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

		let desiredSlot: string | null = null;
		let desiredDate: string | null = null;
		if (flow.step === 3 && flow.selectedSlot) {
			desiredSlot = flow.selectedSlot;
		} else if (flow.viewDate) {
			desiredDate = flow.viewDate;
		}

		// Compare decoded values, not the encoded search string, so re-encoding can't loop.
		if (
			page.url.searchParams.get('slot') === desiredSlot &&
			page.url.searchParams.get('date') === desiredDate
		) {
			return;
		}

		let search = '';
		if (desiredSlot) {
			search = `?slot=${encodeURIComponent(desiredSlot)}`;
		} else if (desiredDate) {
			search = `?date=${encodeURIComponent(desiredDate)}`;
		}

		replaceState(`${page.url.pathname}${search}`, page.state);
	});
</script>

<svelte:head>
	<title>{data.eventType.name} — {data.user.name}</title>
</svelte:head>

<header class="page-banner">
	<a href="/" class="banner-link">
		{#if data.user.branding?.avatar_url || data.user.branding?.logo_url}
			<img
				src={data.user.branding?.avatar_url || data.user.branding?.logo_url}
				alt={data.user.name}
				class="banner-avatar"
			/>
		{/if}
		<div class="banner-text">
			<span class="banner-title">{data.user.branding?.page_title || data.user.name}</span>
			{#if data.user.branding?.descriptionHtml}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<div class="banner-desc">{@html data.user.branding.descriptionHtml}</div>
			{/if}
		</div>
	</a>
	<div class="banner-event">
		<h1 class="banner-event-name">{data.eventType.name}</h1>
		<p class="banner-event-meta">
			{data.eventType.duration} min{#if data.eventType.description}
				&middot; {data.eventType.description}{/if}
		</p>
	</div>
</header>

<div class="appointment">
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
			<aside class="reschedule-banner">
				<span class="reschedule-banner-icon"><IconInfo aria-hidden="true" /></span>
				<span class="reschedule-banner-text">
					Rescheduling <a class="reschedule-banner-link" href={previousAppointmentHref}
						>previous appointment</a
					>
					for {formatSlot(data.rescheduleAppt.start_time, userTz)}.
				</span>
			</aside>
		{/if}

		{#if linkNotice && (step === 1 || linkNotice.kind === 'slot')}
			<aside class="warning-card">
				<span class="warning-card-icon"><IconWarningCircle aria-hidden="true" /></span>
				<div class="warning-card-content">
					<span class="warning-card-text">
						{#if linkNotice.kind === 'slot'}
							<strong>{formatSlot(linkNotice.requested, userTz)}</strong> is no longer available. Pick
							another time below.
						{:else}
							<strong>{formatDate(linkNotice.requested)}</strong> has no availability. Pick another day
							below.
						{/if}
					</span>
				</div>
			</aside>
		{/if}

		<div class="card">
			<aside class="card-context">
				<section class="context-section">
					<a href="/" class="context-provider">
						{#if data.user.branding?.avatar_url || data.user.branding?.logo_url}
							<img
								src={data.user.branding?.avatar_url || data.user.branding?.logo_url}
								alt={data.user.name}
								class="context-provider-avatar"
							/>
						{/if}
						<div class="context-provider-text">
							<span class="context-provider-name"
								>{data.user.branding?.page_title || data.user.name}</span
							>
							{#if data.user.branding?.descriptionHtml}
								<!-- eslint-disable svelte/no-at-html-tags -->
								<div class="context-provider-desc">
									{@html data.user.branding.descriptionHtml}
								</div>
								<!-- eslint-enable svelte/no-at-html-tags -->
							{/if}
						</div>
					</a>
				</section>

				<section class="context-section context-section-about">
					<h2 class="context-event-name">{data.eventType.name}</h2>
					<p class="context-event-meta">{data.eventType.duration} min</p>
					{#if data.eventType.description}
						<p class="context-event-description">{data.eventType.description}</p>
					{/if}
				</section>

				<section class="context-step">
					<span class="context-step-num">Step {step} of 3</span>
					<h2 class="context-step-title">
						{#if step === 1}Pick a day{:else if step === 2}Pick a time{:else}Enter your info{/if}
					</h2>
				</section>
			</aside>

			<div class="card-stage">
				<div class="appointment-body">
					{#if step === 1}
						{#if ptz.current}
							<DatePicker {flow} />
						{:else}
							<div class="cal-skeleton" aria-hidden="true">
								<div class="skel-header">
									<span class="skel-heading"></span>
									<div class="skel-nav">
										<span class="skel-navbtn"></span>
										<span class="skel-navbtn"></span>
									</div>
								</div>
								<div class="skel-grid">
									<div class="skel-weekdays">
										{#each Array.from({ length: 7 }, (_, i) => i) as i (i)}
											<span class="skel-weekday"></span>
										{/each}
									</div>
									{#each Array.from({ length: 6 }, (_, i) => i) as r (r)}
										<div class="skel-row">
											{#each Array.from({ length: 7 }, (_, i) => i) as c (c)}
												<span class="skel-cell"></span>
											{/each}
										</div>
									{/each}
								</div>
							</div>
						{/if}
					{:else if step === 2}
						{#if ptz.current}
							<DayTimeline
								{flow}
								workingWindows={data.workingWindows}
								busyBlocks={data.busyBlocks}
								eventType={data.eventType}
								originalSlot={data.rescheduleAppt?.start_time ?? null}
								onEditDate={flow.goBack}
							/>
						{:else}
							<div class="tl-skeleton" aria-hidden="true">
								<div class="skel-header">
									<span class="skel-heading"></span>
									<span class="skel-tz"></span>
								</div>
								<div class="tl-skel-scroll">
									<div class="tl-skel-track" style:height="{timelineSkeletonRows * 96}px">
										{#each Array.from({ length: timelineSkeletonRows }, (_, i) => i) as i (i)}
											<div class="tl-skel-row" style:top="{i * 96}px">
												<span class="tl-skel-label"></span>
												<span class="tl-skel-gridline"></span>
											</div>
										{/each}
										<span class="tl-skel-slot"></span>
									</div>
								</div>
							</div>
						{/if}
					{/if}

					{#if step === 3 && selectedSlot}
						<div class="form-header">
							<button
								type="button"
								class="form-back"
								onclick={flow.goBack}
								aria-label="Back to time picker"
							>
								<IconCaretLeft aria-hidden="true" />
							</button>
							<h2 class="form-title">
								{#if viewDate}{formatDateCompact(viewDate)} at&nbsp;{/if}{formatTimeShort(
									selectedSlot,
									userTz
								)}
								<span class="form-title-tz">{formatTzAbbrev(selectedSlot, userTz)}</span>
							</h2>
						</div>
						<div class="appointment-form">
							{#if form?.error}
								<p class="form-error" role="alert">{form.error}</p>
							{/if}

							<form id="appointment-form" method="POST" action={formAction}>
								<input type="hidden" name="slot" value={selectedSlot} />
								<input type="hidden" name="timezone" value={userTz} />
								{#if data.rescheduleAppt}
									<input type="hidden" name="reschedule" value={data.rescheduleAppt.id} />
									<input type="hidden" name="token" value={data.rescheduleToken} />
								{/if}

								{#each data.formFields as field (field.id)}
									<div class="field">
										<label for={field.id}>
											{field.label}{#if field.required}<span class="field-req" aria-hidden="true"
													>*</span
												>{/if}
										</label>
										{#if field.type === 'attendee_name'}
											<input
												id={field.id}
												name={field.id}
												type="text"
												required
												autocomplete="name"
												maxlength="200"
												bind:this={nameInput}
												value={initialFieldValue(field)}
											/>
										{:else if field.type === 'attendee_email'}
											<input
												id={field.id}
												name={field.id}
												type="email"
												required={field.required}
												autocomplete="email"
												maxlength="254"
												value={initialFieldValue(field)}
											/>
										{:else if field.type === 'number'}
											<input
												id={field.id}
												name={field.id}
												type="number"
												required={field.required}
												value={initialFieldValue(field)}
											/>
										{:else if field.type === 'paragraph'}
											<textarea
												id={field.id}
												name={field.id}
												rows="3"
												required={field.required}
												maxlength="1000"
												bind:value={paragraphValues[field.id]}
											></textarea>
											<span class="field-count"
												>{(paragraphValues[field.id] ?? '').length}/1000</span
											>
										{:else if field.type === 'choice' || (field.type === 'event_location' && field.choices)}
											<select id={field.id} name={field.id} required={field.required}>
												{#if !field.required}<option value="">Select an option</option>{/if}
												{#each field.choices ?? [] as choice (choice)}
													<option value={choice} selected={choice === initialFieldValue(field)}
														>{choice}</option
													>
												{/each}
											</select>
										{:else}
											<input
												id={field.id}
												name={field.id}
												type="text"
												required={field.required}
												maxlength="200"
												value={initialFieldValue(field)}
											/>
										{/if}
										{#if form?.fieldErrors?.[field.id]}
											<p class="field-error" role="alert">{form.fieldErrors[field.id]}</p>
										{/if}
									</div>
								{/each}

								{#if data.rescheduleAppt}
									<div class="field-separator-container">
										<hr class="wizard-separator" />
									</div>
									<div class="field">
										<label for="reschedule_reason"> Reason for rescheduling </label>
										<textarea
											id="reschedule_reason"
											name="reschedule_reason"
											rows="3"
											maxlength="500"
											placeholder="e.g. scheduling conflict, double booked..."
											required
											bind:value={rescheduleReasonValue}
										></textarea>
										<span class="field-count">{(rescheduleReasonValue ?? '').length}/500</span>
									</div>
								{/if}

								<button type="submit" class="submit-btn">
									{#if data.rescheduleAppt}Confirm Reschedule{:else if data.eventType.appointment_flow === 'requires_confirmation'}Request{:else}Schedule{/if}
								</button>
							</form>
						</div>
					{/if}
				</div>

				<div class="wizard-cta">
					<p class="cta-title">
						<span class="wizard-step">Step {step} of 3:</span>
						{#if step === 1}Pick a day{:else if step === 2}Pick a time{:else}Enter your info{/if}
					</p>
					{#if step === 1 && viewDate}
						<p class="cta-summary">You selected {formatDate(viewDate)}</p>
					{:else if step === 2 && selectedSlot}
						<p class="cta-summary">You selected {formatTime(selectedSlot, userTz)}</p>
					{/if}

					{#if step === 1}
						<button
							type="button"
							class="cta-btn"
							onclick={flow.advance}
							disabled={!flow.canAdvance}
						>
							Continue <span class="cta-arrow"><IconArrowRight aria-hidden="true" /></span>
						</button>
					{:else if step === 2}
						<button type="button" class="cta-btn cta-btn-secondary" onclick={flow.goBack}>
							Back
						</button>
						<button
							type="button"
							class="cta-btn"
							onclick={flow.advance}
							disabled={!flow.canAdvance}
						>
							Confirm <span class="cta-arrow"><IconArrowRight aria-hidden="true" /></span>
						</button>
					{:else}
						<button type="button" class="cta-btn cta-btn-secondary" onclick={flow.goBack}>
							Back
						</button>
						<button type="submit" form="appointment-form" class="cta-btn" disabled={!selectedSlot}>
							{#if data.rescheduleAppt}Confirm Reschedule{:else if data.eventType.appointment_flow === 'requires_confirmation'}Request{:else}Schedule{/if}
						</button>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

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

	.card-context {
		flex: 0 0 30%;
		padding: var(--space-7);
		border-right: 1px solid var(--border);
		background: var(--surface-muted);
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}

	.context-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.context-section-about {
		padding: var(--space-6) 0 0;
		border-top: 1px solid var(--border-strong);
	}

	.context-provider {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}

	.context-provider:hover .context-provider-name {
		opacity: 0.8;
	}

	.context-provider-avatar {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
	}

	.context-provider-text {
		min-width: 0;
	}

	.context-provider-name {
		font-size: var(--font-size-md);
		font-weight: 700;
		transition: opacity var(--transition);
	}

	.context-provider-desc {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		margin-top: var(--space-1);
	}

	.context-provider-desc :global(p) {
		margin: 0;
	}

	.context-event-name {
		font-size: var(--font-size-xl);
		font-weight: 700;
		margin: 0 0 var(--space-2);
		color: var(--text);
	}

	.context-event-meta {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		margin: 0 0 var(--space-3);
	}

	.context-event-description {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		margin: 0;
		line-height: 1.5;
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

	.skel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-7);
	}

	.skel-heading {
		height: var(--font-size-xl);
		width: 9rem;
		border-radius: var(--radius-sm);
		background: var(--surface-muted);
	}

	.skel-nav {
		display: flex;
		gap: var(--space-1);
	}

	.skel-navbtn {
		width: var(--space-7);
		height: var(--space-7);
		border-radius: var(--radius-sm);
		background: var(--surface-muted);
	}

	.skel-grid {
		width: 100%;
		max-width: 360px;
		margin: 0 auto;
	}

	.skel-weekdays {
		display: flex;
		width: 100%;
		margin-bottom: var(--space-2);
		background: var(--surface-muted);
		border-radius: var(--radius-sm);
	}

	.skel-weekday {
		flex: 1;
		height: calc(var(--font-size-xs) + var(--space-4));
	}

	.skel-row {
		display: flex;
		width: 100%;
	}

	.skel-cell {
		flex: 1;
		aspect-ratio: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.skel-cell::before {
		content: '';
		width: 55%;
		height: 55%;
		border-radius: 50%;
		background: var(--surface-muted);
	}

	.skel-tz {
		align-self: center;
		width: 4rem;
		height: var(--font-size-md);
		border-radius: var(--radius-sm);
		background: var(--surface-muted);
	}

	.tl-skel-scroll {
		position: relative;
		max-height: 60vh;
		overflow: hidden;
	}

	.tl-skel-track {
		position: relative;
		margin-left: 60px;
		border-left: 1px solid var(--border-strong);
	}

	.tl-skel-row {
		position: absolute;
		left: 0;
		right: 0;
	}

	.tl-skel-label {
		position: absolute;
		left: -60px;
		top: -0.5em;
		width: 40px;
		height: var(--font-size-sm);
		border-radius: var(--radius-sm);
		background: var(--surface-muted);
	}

	.tl-skel-gridline {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 1px;
		background: var(--border);
	}

	.tl-skel-slot {
		position: absolute;
		left: var(--space-4);
		right: var(--space-4);
		top: 112px;
		height: 48px;
		border-radius: var(--radius-sm);
		background: var(--surface-muted);
	}

	.appointment-form {
		width: 100%;
	}

	/* ---- appointment form ---- */
	.form-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 0 var(--space-7);
		min-width: 0;
	}

	.form-title {
		font-size: var(--font-size-xl);
		font-weight: 600;
		margin: 0;
	}

	.form-title-tz {
		font-size: var(--font-size-md);
		font-weight: 400;
		color: var(--text-muted);
	}

	/* caret to return to the time picker — mobile only (desktop has the wizard back button) */
	.form-back {
		display: none;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		background: none;
		border: none;
		padding: var(--space-1);
		margin-left: calc(var(--space-2) * -1);
		font-size: var(--font-size-xl);
		line-height: 1;
		color: var(--text-muted);
		cursor: pointer;
		transition: color var(--transition);
	}

	.form-back:hover {
		color: var(--text);
	}

	.form-error {
		background: var(--danger-bg);
		color: var(--danger);
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius);
		font-size: var(--font-size-base);
		margin-bottom: var(--space-6);
	}

	.field {
		margin-bottom: var(--space-5);
	}

	.field label {
		display: block;
		font-size: var(--font-size-sm);
		font-weight: 600;
		margin-bottom: var(--space-2);
		color: var(--text-secondary);
	}

	.field-req {
		color: var(--danger);
		margin-left: 2px;
	}

	.field input,
	.field select,
	.field textarea {
		width: 100%;
		padding: var(--space-4) var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		box-sizing: border-box;
		transition: border-color var(--transition);
		background: var(--surface);
		color: var(--text);
	}

	.field input:focus,
	.field select:focus,
	.field textarea:focus {
		outline: none;
		border-color: var(--primary);
		box-shadow: var(--shadow-focus);
	}

	.field-count {
		display: block;
		margin-top: var(--space-1);
		text-align: right;
		font-size: var(--font-size-xs);
		color: var(--text-muted);
	}

	.field-error {
		margin: var(--space-2) 0 0;
		font-size: var(--font-size-sm);
		color: var(--danger);
	}

	.submit-btn {
		display: none;
	}

	/* ---- wizard chrome ---- */
	.context-step {
		margin-top: auto;
		padding-top: var(--space-6);
		border-top: 1px solid var(--border-strong);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.context-step-num {
		font-size: var(--font-size-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}

	.context-step-title {
		margin: 0;
		font-size: var(--font-size-md);
		font-weight: 700;
		color: var(--text);
	}

	.wizard-step {
		font-weight: 500;
		color: var(--text-muted);
		margin-right: var(--space-2);
	}

	.wizard-cta {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-4);
		margin-top: var(--space-6);
		padding-top: var(--space-5);
		border-top: 1px solid var(--border);
	}

	.cta-summary {
		margin: 0 auto 0 0;
		color: var(--text-secondary);
		font-size: var(--font-size-md);
		font-weight: 500;
		display: flex;
		align-items: center;
	}

	.cta-arrow {
		display: inline-flex;
		margin-left: var(--space-2);
		transition: transform var(--transition);
	}

	.cta-btn:not(:disabled):hover .cta-arrow {
		transform: translateX(2px);
	}

	.cta-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: var(--space-3) var(--space-7);
		background: var(--primary);
		color: var(--text-on-primary);
		border: none;
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
		transition: opacity var(--transition);
	}

	.cta-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.cta-btn:not(:disabled):hover {
		opacity: 0.9;
	}

	.cta-btn-secondary {
		background: transparent;
		color: var(--text-secondary);
		border: 1px solid var(--border-strong);
	}

	.cta-btn-secondary:not(:disabled):hover {
		background: var(--surface-active);
		color: var(--text);
		opacity: 1;
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

		.cta-title {
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

		.card-context {
			display: none;
		}

		.card-stage {
			padding: 0;
		}

		.form-back {
			display: inline-flex;
		}

		.appointment :global(.timeline-scroll),
		.tl-skel-scroll {
			max-height: none;
			overflow: visible;
		}

		.cta-summary {
			display: none;
		}

		.cta-title {
			margin: 0 0 var(--space-2);
			font-size: var(--font-size-md);
			font-weight: 600;
			color: var(--text);
		}

		.cta-btn {
			min-height: 56px;
			width: 100%;
			padding: var(--space-4) var(--space-6);
		}

		.cta-btn-secondary {
			display: none;
		}

		.wizard-cta {
			display: block;
			justify-content: initial;
			border-top: none;
			padding-top: 0;
			margin: 0;
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			padding: var(--space-4) var(--space-5) calc(var(--space-4) + env(safe-area-inset-bottom));
			background: var(--surface);
			border-top: 1px solid var(--border);
			z-index: 100;
		}
	}

	/* ---- warning card ---- */
	.warning-card {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-6);
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-6);
		color: var(--text);
	}

	.warning-card-icon {
		font-size: var(--font-size-xl);
		color: var(--warning);
		flex-shrink: 0;
		margin-top: 2px;
		display: inline-flex;
	}

	.warning-card-content {
		flex: 1;
	}

	.warning-card-text {
		font-size: var(--font-size-md);
		line-height: 1.5;
		color: var(--text-secondary);
	}

	.warning-card-text strong {
		color: var(--text);
		font-weight: 600;
	}

	/* ---- reschedule banner ---- */
	.reschedule-banner {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-6);
		margin-bottom: var(--space-6);
		background: var(--info-bg);
		border: 1px solid var(--info-border);
		border-radius: var(--radius-md);
	}

	.reschedule-banner-icon {
		font-size: var(--font-size-xl);
		color: var(--info-strong);
		flex-shrink: 0;
		display: inline-flex;
	}

	.reschedule-banner-text {
		font-size: var(--font-size-md);
		line-height: 1.4;
		color: var(--text);
	}

	.reschedule-banner-link {
		color: var(--info-strong);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.reschedule-banner-link:hover {
		text-decoration: none;
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

	.field-separator-container {
		margin: var(--space-6) 0 var(--space-6);
	}

	.wizard-separator {
		border: 0;
		border-top: 1px dashed var(--border-strong);
		margin: 0;
	}
</style>
