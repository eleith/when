<script lang="ts">
	import { page } from '$app/state';
	import { replaceState, afterNavigate } from '$app/navigation';
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import IconInfo from 'virtual:icons/ph/info';
	import DatePicker from '$lib/components/DatePicker.svelte';
	import DayTimeline from '$lib/components/DayTimeline.svelte';
	import DurationDialog from '$lib/components/DurationDialog.svelte';
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
	import { PHONE_PATTERN } from '$lib/forms/phone';
	import { evaluateVisibility } from '$lib/forms/conditional';
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
	let activeDuration = $state(
		data.eventType.durations.includes(durationParam) ? durationParam : data.eventType.durations[0]
	);
	const activeSlots = $derived(data.slotsByDuration[activeDuration] ?? {});

	const flow = createAppointmentFlow(() => activeSlots);
	const ptz = getPreferredTimezone();

	// Changing the length can drop the selected time; if it no longer fits, clear it
	// and step back so the guest re-picks.
	$effect(() => {
		if (flow.selectedSlot && !flow.allSlots.includes(flow.selectedSlot)) {
			flow.clearSlot();
			if (flow.step === 3) flow.goToStep(2);
		}
	});

	let step = $derived(flow.step);
	let viewDate = $derived(flow.viewDate);
	let selectedSlot = $derived(flow.selectedSlot);
	let userTz = $derived(flow.userTz);

	const durations = $derived(data.eventType.durations);
	const activeEventType = $derived({ ...data.eventType, duration_minutes: activeDuration });

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

	let durationOpen = $state(false);
	let routerReady = $state(false);
	let nameInput = $state<HTMLInputElement | null>(null);
	let rescheduleReasonEl = $state<HTMLTextAreaElement | null>(null);
	let linkNotice = $state<NonNullable<DeepLinkResult['notice']> | null>(null);

	// svelte-ignore state_referenced_locally
	const priorAnswers = data.rescheduleAppt?.answers ?? [];

	function initialFieldValue(field: FormField): string {
		const r = data.rescheduleAppt;
		if (!r) return '';
		if (field.type === 'guest_name') return r.guest_name ?? '';
		if (field.type === 'guest_email') return r.guest_email ?? '';
		if (field.type === 'event_location') return r.location ?? '';
		return priorAnswers.find((a) => a.name === field.name)?.value ?? '';
	}

	// svelte-ignore state_referenced_locally
	let fieldValues = $state<Record<string, string>>(
		Object.fromEntries(data.formFields.map((f) => [f.name, initialFieldValue(f)]))
	);

	const visibleFields = $derived(
		evaluateVisibility(data.formFields, (name) => fieldValues[name] ?? '')
	);

	function trackFieldValue(event: Event) {
		const target = event.target as
			| HTMLInputElement
			| HTMLSelectElement
			| HTMLTextAreaElement
			| null;
		if (target?.name) fieldValues[target.name] = target.value;
	}

	let rescheduleReasonValue = $state('');
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
		if (step === 3 && selectedSlot) {
			if (fieldsDisabled) {
				rescheduleReasonEl?.focus();
			} else {
				nameInput?.focus();
			}
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

		const desiredDuration = activeDuration === durations[0] ? null : String(activeDuration);
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
						{#if data.user.appearance.avatar_url}
							<img
								src={data.user.appearance.avatar_url}
								alt={data.user.name}
								class="context-provider-avatar"
							/>
						{/if}
					</a>
				</section>

				<section class="context-section context-section-about">
					<h1 class="context-event-name">{data.eventType.name}</h1>
					{#if data.eventType.description}
						<p class="context-event-meta">{data.eventType.description}</p>
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
								eventType={activeEventType}
								bookingStyle={data.eventType.booking_style}
								originalSlot={data.rescheduleAppt?.start_time ?? null}
								onEditDate={flow.goBack}
							>
								{#snippet beforeSlots()}
									{#if durations.length > 1}
										<p class="duration-sentence">
											Let's meet for
											<button
												type="button"
												class="duration-pick"
												onclick={() => (durationOpen = true)}
											>
												{activeDuration} minutes
											</button>
										</p>
									{/if}
								{/snippet}
							</DayTimeline>
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

							<form
								id="appointment-form"
								method="POST"
								action={formAction}
								oninput={trackFieldValue}
								onchange={trackFieldValue}
							>
								<input type="hidden" name="slot" value={selectedSlot} />
								<input type="hidden" name="timezone" value={userTz} />
								<input type="hidden" name="duration" value={activeDuration} />
								{#if data.rescheduleAppt}
									<input type="hidden" name="reschedule" value={data.rescheduleAppt.id} />
									<input type="hidden" name="token" value={data.rescheduleToken} />
								{/if}

								{#each data.formFields as field (field.name)}
									{#if visibleFields.get(field.name)}
										<div class="field">
											<label for={field.name}>
												{field.label}{#if field.required && !fieldsDisabled}<span
														class="field-req"
														aria-hidden="true">*</span
													>{/if}
											</label>
											{#if field.type === 'guest_name'}
												<input
													id={field.name}
													name={field.name}
													type="text"
													required={!fieldsDisabled}
													disabled={fieldsDisabled}
													autocomplete="name"
													maxlength="200"
													bind:this={nameInput}
													value={initialFieldValue(field)}
												/>
											{:else if field.type === 'guest_email'}
												<input
													id={field.name}
													name={field.name}
													type="email"
													required={field.required && !fieldsDisabled}
													disabled={fieldsDisabled}
													autocomplete="email"
													maxlength="254"
													value={initialFieldValue(field)}
												/>
											{:else if field.type === 'number'}
												<input
													id={field.name}
													name={field.name}
													type="number"
													required={field.required && !fieldsDisabled}
													disabled={fieldsDisabled}
													value={initialFieldValue(field)}
												/>
											{:else if field.type === 'phone'}
												<input
													id={field.name}
													name={field.name}
													type="tel"
													inputmode="tel"
													autocomplete="tel"
													required={field.required && !fieldsDisabled}
													disabled={fieldsDisabled}
													pattern={PHONE_PATTERN}
													maxlength="25"
													value={initialFieldValue(field)}
												/>
											{:else if field.type === 'paragraph'}
												<textarea
													id={field.name}
													name={field.name}
													rows="3"
													required={field.required && !fieldsDisabled}
													disabled={fieldsDisabled}
													maxlength="1000"
													value={initialFieldValue(field)}
												></textarea>
												{#if !fieldsDisabled}
													<span class="field-count"
														>{(fieldValues[field.name] ?? '').length}/1000</span
													>
												{/if}
											{:else if field.type === 'choice' || (field.type === 'event_location' && field.choices)}
												<select
													id={field.name}
													name={field.name}
													required={field.required && !fieldsDisabled}
													disabled={fieldsDisabled}
												>
													{#if !field.required}<option value="">Select an option</option>{/if}
													{#each field.choices ?? [] as choice (choice)}
														<option value={choice} selected={choice === initialFieldValue(field)}
															>{choice}</option
														>
													{/each}
												</select>
											{:else}
												<input
													id={field.name}
													name={field.name}
													type="text"
													required={field.required && !fieldsDisabled}
													disabled={fieldsDisabled}
													maxlength="200"
													value={initialFieldValue(field)}
												/>
											{/if}
											{#if form?.fieldErrors?.[field.name]}
												<p class="field-error" role="alert">{form.fieldErrors[field.name]}</p>
											{/if}
										</div>
									{/if}
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
											bind:this={rescheduleReasonEl}
										></textarea>
										<span class="field-count">{(rescheduleReasonValue ?? '').length}/500</span>
									</div>
								{/if}

								<button type="submit" class="submit-btn">
									{#if data.rescheduleAppt}Confirm Reschedule{:else if data.eventType.booking_approval === 'request'}Request{:else}Schedule{/if}
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
							{#if data.rescheduleAppt}Confirm Reschedule{:else if data.eventType.booking_approval === 'request'}Request{:else}Schedule{/if}
						</button>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</main>

<DurationDialog bind:open={durationOpen} {durations} bind:value={activeDuration} />

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

	.context-provider {
		display: inline-flex;
		text-decoration: none;
		color: inherit;
	}

	.context-provider:hover .context-provider-avatar {
		opacity: 0.8;
	}

	.context-provider-avatar {
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
		border: solid 2px var(--text);
		transition: opacity var(--transition);
	}

	.context-event-name {
		font-size: var(--font-size-xl);
		font-weight: 700;
		margin: 0 0 var(--space-2);
		color: var(--text);
	}

	.context-event-meta {
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

	/* A quiet prompt between the day/timezone header and the time slots on step 2. */
	.duration-sentence {
		margin: var(--space-4) 0;
		padding: var(--space-5) 0;
		border-top: 1px solid var(--border);
		text-align: center;
		font-size: var(--font-size-lg);
		color: var(--text-secondary);
	}

	.duration-pick {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.duration-pick:hover {
		text-decoration-thickness: 2px;
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

	input:disabled,
	textarea:disabled,
	select:disabled {
		background: var(--surface-muted);
		border-color: var(--border);
		color: var(--text-muted);
		cursor: not-allowed;
		opacity: 0.7;
	}
</style>
