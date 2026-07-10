<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { tick } from 'svelte';
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import AdminNav from '$lib/components/AdminNav.svelte';
	import IconClock from 'virtual:icons/ph/clock';
	import IconMapPin from 'virtual:icons/ph/map-pin';
	import IconUser from 'virtual:icons/ph/user';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import IconCheckCircle from 'virtual:icons/ph/check-circle';
	import IconNote from 'virtual:icons/ph/note';
	import IconPencilSimple from 'virtual:icons/ph/pencil-simple';
	import IconVideo from 'virtual:icons/ph/video-conference';
	import AppointmentActions from '$lib/components/AppointmentActions.svelte';
	import AppointmentLog from '$lib/components/AppointmentLog.svelte';
	import AppointmentQuestions from '$lib/components/AppointmentQuestions.svelte';
	import AddToCalendar from '$lib/components/AddToCalendar.svelte';
	import { formatDateShort, formatWeekday, formatTimeRange, formatTzShort } from '$lib/datetime';

	let { data, form } = $props();

	let cancelDialogOpen = $state(false);
	let editNoteDialogOpen = $state(false);
	let editLocationDialogOpen = $state(false);
	let editVideoChatDialogOpen = $state(false);
	let cancelReason = $state('I can no longer attend');
	let editNoteValue = $state('');
	let editLocationValue = $state('');
	let editVideoChatValue = $state('');
	let reasonTextarea = $state<HTMLTextAreaElement | null>(null);
	let noteTextareaEl = $state<HTMLTextAreaElement | null>(null);
	let locationInputEl = $state<HTMLInputElement | null>(null);
	let videoChatInputEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (cancelDialogOpen) {
			cancelReason = 'I can no longer attend';
			tick().then(() => {
				reasonTextarea?.focus();
				reasonTextarea?.select();
			});
		}
	});

	$effect(() => {
		if (editNoteDialogOpen) {
			editNoteValue = data.appointment.note ?? '';
			tick().then(() => {
				noteTextareaEl?.focus();
				noteTextareaEl?.select();
			});
		}
	});

	$effect(() => {
		if (editLocationDialogOpen) {
			editLocationValue = data.appointment.location ?? '';
			tick().then(() => {
				locationInputEl?.focus();
				locationInputEl?.select();
			});
		}
	});

	$effect(() => {
		if (editVideoChatDialogOpen) {
			editVideoChatValue = data.appointment.video_chat ?? '';
			tick().then(() => {
				videoChatInputEl?.focus();
				videoChatInputEl?.select();
			});
		}
	});

	$effect(() => {
		if (data.appointment.status === 'cancelled') cancelDialogOpen = false;
	});

	$effect(() => {
		const actionData = form as unknown as { success?: string };
		if (actionData?.success === 'edited') {
			editNoteDialogOpen = false;
			editLocationDialogOpen = false;
		}
	});

	let status = $derived(data.appointment.status);
	let isEditable = $derived(
		(status === 'pending' || status === 'confirmed') && data.clockStatus !== 'concluded'
	);
	let stateTone = $derived.by(() => {
		if (status === 'declined' || status === 'cancelled' || status === 'expired') return 'danger';
		if (status === 'rescheduled' || status === 'purged') return 'quiet';
		if (status === 'pending') return 'warning';
		if (data.clockStatus === 'in_progress') return 'active';
		if (data.clockStatus === 'concluded') return 'quiet';
		return 'info';
	});
	let canRebook = $derived(status === 'declined' || status === 'cancelled' || status === 'expired');
	let displayTz = $derived(data.isAdmin ? data.hostTz : data.guestTz);
	let counterpartTz = $derived(data.isAdmin ? data.guestTz : data.hostTz);
	let counterpartName = $derived(data.isAdmin ? data.appointment.guest_name : data.user.name);
	let zonesDiffer = $derived(displayTz !== counterpartTz);
	let hasActions = $derived(data.actions.cancel.allowed || data.actions.reschedule.allowed);
	let showDecideCta = $derived(
		!data.calendarLinks && (data.actions.accept.allowed || data.actions.decline.allowed)
	);

	let cancelEntry = $derived(data.appointment.action_log.findLast((e) => e.action === 'cancel'));
	let rescheduleEntry = $derived(
		data.appointment.action_log.findLast(
			(e) => e.action === 'reschedule' && e.payload?.metadata?.next_id === data.appointment.id
		)
	);

	let notes = $derived(
		[status === 'cancelled' ? cancelEntry : undefined, rescheduleEntry]
			.filter((e) => e?.payload?.note)
			.map((e) => ({ actor: e!.actor, kind: e!.action, text: e!.payload!.note! }))
	);
</script>

<svelte:head>
	{#if status === 'cancelled'}
		<title>Appointment cancelled — When</title>
	{:else if status === 'expired'}
		<title>Appointment expired — When</title>
	{:else if status === 'declined'}
		<title>Appointment declined — When</title>
	{:else if status === 'rescheduled'}
		<title>Appointment rescheduled — When</title>
	{:else if status === 'purged'}
		<title>Appointment purged — When</title>
	{:else if status === 'pending'}
		<title>Appointment requested — When</title>
	{:else}
		<title>Appointment confirmed — When</title>
	{/if}
</svelte:head>

{#if data.isAdmin}
	<AdminNav />
{/if}

<main class="page" class:has-cta={!!data.calendarLinks || showDecideCta}>
	{#if form?.error}
		<aside class="banner banner-danger" role="alert">
			<span class="banner-icon"><IconWarningCircle aria-hidden="true" /></span>
			<p class="banner-text">{form.error}</p>
		</aside>
	{/if}

	<div class="page-header-container">
		<div class="page-header-icon status-{stateTone}">
			{#if status === 'confirmed'}
				<IconCheckCircle aria-hidden="true" />
			{:else if status === 'pending'}
				<IconClock aria-hidden="true" />
			{:else if status === 'cancelled' || status === 'declined' || status === 'expired' || status === 'purged'}
				<IconWarningCircle aria-hidden="true" />
			{:else}
				<IconClock aria-hidden="true" />
			{/if}
		</div>
		<h1 class="page-header-title">
			{#if !data.isAdmin && data.flash}
				{#if data.flash === 'request'}
					{#if status === 'confirmed'}
						Appointment created
					{:else}
						Appointment requested
					{/if}
				{:else if data.flash === 'reschedule'}
					{#if status === 'confirmed'}
						Appointment rescheduled
					{:else}
						Reschedule requested
					{/if}
				{/if}
			{:else if status === 'confirmed'}
				Confirmed
			{:else if status === 'pending'}
				Pending
			{:else if status === 'cancelled'}
				Cancelled
			{:else if status === 'declined'}
				Declined
			{:else if status === 'expired'}
				Expired
			{:else if status === 'rescheduled'}
				Rescheduled
			{:else if status === 'purged'}
				Purged
			{:else}
				Appointment
			{/if}
		</h1>
		<p class="page-header-desc">
			{#if status === 'confirmed'}
				{#if data.flash}
					{#if data.appointment.guest_email}
						A confirmation has been sent to <strong>{data.appointment.guest_email}</strong>.
					{:else}
						Your appointment is confirmed.
					{/if}
				{:else}
					See you soon!
				{/if}
			{:else if status === 'pending'}
				{#if data.appointment.guest_email}
					We will email you once confirmed.
				{:else}
					Check back here to see when it's confirmed.
				{/if}
			{:else if status === 'cancelled'}
				This appointment has been cancelled.
			{:else if status === 'declined'}
				This appointment request was declined.
			{:else if status === 'expired'}
				This appointment request has expired.
			{:else if status === 'purged'}
				This appointment is being deleted.
			{:else}
				This appointment has been rescheduled to a new date.
			{/if}
		</p>
	</div>

	<article class="card">
		<section class="card-section card-section-header">
			<div class="event-heading">
				<h1 class="event-name">{data.eventType.name}</h1>
				{#if data.eventType.description}
					<p class="event-meta">{data.eventType.description}</p>
				{/if}
			</div>
			{#if (hasActions || data.isAdmin) && status !== 'purged'}
				<AppointmentActions
					actions={data.actions}
					appointmentId={data.appointment.id}
					token={data.token}
					isAdmin={data.isAdmin}
					onCancel={() => (cancelDialogOpen = true)}
					hasNote={!!data.appointment.note}
					onEditNote={() => (editNoteDialogOpen = true)}
					hasLocation={!!data.appointment.location}
					onEditLocation={() => (editLocationDialogOpen = true)}
					hasVideoChat={!!data.appointment.video_chat}
					onEditVideoChat={() => (editVideoChatDialogOpen = true)}
					{isEditable}
				/>
			{/if}
		</section>

		<section class="card-section card-state state-{stateTone}">
			<span class="state-dot" aria-hidden="true"></span>
			<div class="state-info-group">
				<span class="state-text">
					{#if status === 'confirmed'}
						{#if data.clockStatus === 'upcoming'}Upcoming
						{:else if data.clockStatus === 'in_progress'}In progress
						{:else}Concluded{/if}
					{:else if status === 'pending'}
						Pending · waiting for host
					{:else if status === 'declined'}
						Declined
					{:else if status === 'expired'}
						Expired
					{:else if status === 'rescheduled'}
						Rescheduled
					{:else if status === 'purged'}
						Purged
					{:else}
						Cancelled
					{/if}
				</span>
				{#if notes.length}
					<div class="state-notes">
						{#each notes as note, i (i)}
							<div class="state-note-line">
								{#if note.actor === 'host'}Host{:else if note.actor === 'guest'}Guest{:else}System{/if}:
								{note.text}
							</div>
						{/each}
					</div>
				{/if}
			</div>
			{#if data.rescheduledFrom || data.latestAppointment}
				<span class="state-meta">
					{#if data.rescheduledFrom}
						Rescheduled from
						<a
							class="state-meta-link"
							href="/appointment/{data.rescheduledFrom.id}?token={encodeURIComponent(
								data.rescheduledFrom.token
							)}"
						>
							{formatDateShort(data.rescheduledFrom.start_time, displayTz)}
						</a>
					{/if}
					{#if data.rescheduledFrom && data.latestAppointment}&nbsp;·&nbsp;{/if}
					{#if data.latestAppointment}
						<a
							class="state-meta-link"
							href="/appointment/{data.latestAppointment.id}?token={encodeURIComponent(
								data.latestAppointment.token
							)}"
						>
							View latest appointment
						</a>
					{/if}
				</span>
			{/if}
		</section>

		<section class="card-section detail-list">
			<div class="detail-row">
				<span class="detail-icon"><IconCalendarBlank aria-hidden="true" /></span>
				<div class="detail-text">
					<div class="detail-primary">
						{formatDateShort(data.appointment.start_time, displayTz)}
					</div>
					<div class="detail-secondary">
						{formatWeekday(data.appointment.start_time, displayTz)}
					</div>
				</div>
			</div>
			<div class="detail-row">
				<span class="detail-icon"><IconClock aria-hidden="true" /></span>
				<div class="detail-text">
					<div class="detail-primary">
						{formatTimeRange(data.appointment.start_time, data.appointment.end_time, displayTz)}
					</div>
					<div class="detail-secondary">
						{formatTzShort(displayTz)}{#if zonesDiffer}&nbsp;&middot; you{/if}
					</div>
					{#if zonesDiffer}
						<div class="detail-secondary tz-extra">
							{formatTimeRange(
								data.appointment.start_time,
								data.appointment.end_time,
								counterpartTz
							)}
							&middot; {formatTzShort(counterpartTz)} &middot; {counterpartName}
						</div>
					{/if}
				</div>
			</div>
			{#if data.appointment.location}
				{#if data.isAdmin && isEditable}
					<button
						type="button"
						class="detail-row-button"
						onclick={() => (editLocationDialogOpen = true)}
						aria-label="Edit location"
					>
						<span class="detail-icon"><IconMapPin aria-hidden="true" /></span>
						<div class="detail-text">
							<div class="detail-primary">Location</div>
							<div class="detail-secondary location-text-val">{data.appointment.location}</div>
						</div>
						<span class="detail-edit-icon"><IconPencilSimple aria-hidden="true" /></span>
					</button>
				{:else if status === 'confirmed' || data.isAdmin}
					<div class="detail-row">
						<span class="detail-icon"><IconMapPin aria-hidden="true" /></span>
						<div class="detail-text">
							<div class="detail-primary">{data.appointment.location}</div>
						</div>
					</div>
				{/if}
			{/if}
			{#if data.appointment.video_chat}
				{#if data.isAdmin && isEditable}
					<button
						type="button"
						class="detail-row-button"
						onclick={() => (editVideoChatDialogOpen = true)}
						aria-label="Edit video link"
					>
						<span class="detail-icon"><IconVideo aria-hidden="true" /></span>
						<div class="detail-text">
							<div class="detail-primary">Video link</div>
							<div class="detail-secondary conference-text-val">
								<a
									href={data.appointment.video_chat}
									target="_blank"
									rel="noopener noreferrer"
									onclick={(e) => e.stopPropagation()}
								>
									{data.appointment.video_chat}
								</a>
							</div>
						</div>
						<span class="detail-edit-icon"><IconPencilSimple aria-hidden="true" /></span>
					</button>
				{:else}
					<div class="detail-row">
						<span class="detail-icon"><IconVideo aria-hidden="true" /></span>
						<div class="detail-text">
							<div class="detail-primary">Video link</div>
							<div class="detail-secondary conference-text-val">
								<a href={data.appointment.video_chat} target="_blank" rel="noopener noreferrer">
									{data.appointment.video_chat}
								</a>
							</div>
						</div>
					</div>
				{/if}
			{/if}
			<div class="detail-row">
				<span class="detail-icon"><IconUser aria-hidden="true" /></span>
				<div class="detail-text">
					<div class="detail-primary">People</div>
					<div class="detail-secondary">
						{data.appointment
							.guest_name}{#if data.isAdmin && data.appointment.guest_email}&nbsp;&lt;{data
								.appointment.guest_email}&gt;{/if}
					</div>
					<div class="detail-secondary">
						{data.user.name} (host)
					</div>
				</div>
			</div>
			{#if data.appointment.note}
				{#if data.isAdmin && isEditable}
					<button
						type="button"
						class="detail-row-button"
						onclick={() => (editNoteDialogOpen = true)}
						aria-label="Edit note"
					>
						<span class="detail-icon"><IconNote aria-hidden="true" /></span>
						<div class="detail-text">
							<div class="detail-primary">Note</div>
							<div class="detail-secondary note-text-val">{data.appointment.note}</div>
						</div>
						<span class="detail-edit-icon"><IconPencilSimple aria-hidden="true" /></span>
					</button>
				{:else}
					<div class="detail-row">
						<span class="detail-icon"><IconNote aria-hidden="true" /></span>
						<div class="detail-text">
							<div class="detail-primary">Note</div>
							<div class="detail-secondary note-text-val">{data.appointment.note}</div>
						</div>
					</div>
				{/if}
			{/if}
		</section>

		{#if data.appointment.answers.length}
			<AppointmentQuestions answers={data.appointment.answers} />
		{/if}

		{#if data.isAdmin}
			<AppointmentLog log={data.appointment.action_log} {displayTz} />
		{/if}

		{#if data.calendarLinks}
			<section class="card-section card-cta">
				<AddToCalendar links={data.calendarLinks} appointmentId={data.appointment.id} />
			</section>
		{:else if showDecideCta}
			<section class="card-section card-cta decide-cta">
				{#if data.actions.decline.allowed}
					<form
						method="POST"
						action="/admin/appointment/{data.appointment.id}?/decline"
						class="decide-form"
					>
						<button type="submit" class="decide-btn decide-decline">Decline</button>
					</form>
				{/if}
				{#if data.actions.accept.allowed}
					<form
						method="POST"
						action="/admin/appointment/{data.appointment.id}?/accept"
						class="decide-form"
					>
						<button type="submit" class="decide-btn decide-accept">Accept</button>
					</form>
				{/if}
			</section>
		{/if}
	</article>

	{#if !data.isAdmin && canRebook}
		<section class="rebook">
			<a class="rebook-btn" href="/schedule/{data.eventType.slug}">
				Pick another time
				<span class="action-arrow"><IconArrowRight aria-hidden="true" /></span>
			</a>
		</section>
	{/if}
</main>

<Dialog.Root bind:open={cancelDialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="dialog-overlay"></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content>
			{#snippet child({ props })}
				<div {...props} class="dialog-content cancel-dialog">
					<Dialog.Title>
						{#snippet child({ props: titleProps })}
							<h2 {...titleProps} class="cancel-dialog-title">
								Provide your reason for cancelling
							</h2>
						{/snippet}
					</Dialog.Title>

					<p class="cancel-dialog-desc">
						{#if data.isAdmin}
							<strong>{data.appointment.guest_name}</strong> will be notified by email. This can't be
							undone.
						{:else}
							You'll both be notified by email. This can't be undone.
						{/if}
					</p>

					<form
						method="POST"
						action={data.isAdmin
							? `/admin/appointment/${data.appointment.id}?/cancel`
							: `?token=${encodeURIComponent(data.token)}&/cancel`}
					>
						<textarea
							name="reason"
							class="cancel-reason-input"
							placeholder="I can no longer attend"
							maxlength="500"
							rows="3"
							required
							bind:value={cancelReason}
							bind:this={reasonTextarea}
						></textarea>
						<input type="hidden" name="token" value={data.token} />
						<div class="cancel-dialog-actions">
							<button type="submit" class="cancel-confirm-btn">Submit</button>
							<Dialog.Close>
								{#snippet child({ props: closeProps })}
									<button {...closeProps} type="button" class="cancel-cancel-btn">Close</button>
								{/snippet}
							</Dialog.Close>
						</div>
					</form>
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<Dialog.Root bind:open={editNoteDialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="dialog-overlay"></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content>
			{#snippet child({ props })}
				<div {...props} class="dialog-content cancel-dialog">
					<Dialog.Title>
						{#snippet child({ props: titleProps })}
							<h2 {...titleProps} class="cancel-dialog-title">
								{#if data.appointment.note}Edit Note{:else}Add Note{/if}
							</h2>
						{/snippet}
					</Dialog.Title>

					<p class="cancel-dialog-desc">
						This note will be included in the calendar ICS and email notifications sent to the
						guest.
					</p>

					<form method="POST" action="/admin/appointment/{data.appointment.id}?/edit">
						<textarea
							name="note"
							class="cancel-reason-input"
							placeholder="e.g., Note or instructions for the guest"
							maxlength="1000"
							rows="5"
							bind:value={editNoteValue}
							bind:this={noteTextareaEl}
						></textarea>
						<div class="cancel-dialog-actions edit-note-actions">
							<button type="submit" class="cancel-confirm-btn">Save</button>
							{#if data.appointment.note}
								<button
									type="submit"
									class="delete-note-btn"
									onclick={() => {
										editNoteValue = '';
									}}
								>
									Delete
								</button>
							{/if}
							<Dialog.Close>
								{#snippet child({ props: closeProps })}
									<button {...closeProps} type="button" class="cancel-cancel-btn">Close</button>
								{/snippet}
							</Dialog.Close>
						</div>
					</form>
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<Dialog.Root bind:open={editLocationDialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="dialog-overlay"></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content>
			{#snippet child({ props })}
				<div {...props} class="dialog-content cancel-dialog">
					<Dialog.Title>
						{#snippet child({ props: titleProps })}
							<h2 {...titleProps} class="cancel-dialog-title">
								{#if data.appointment.location}Edit Location{:else}Add Location{/if}
							</h2>
						{/snippet}
					</Dialog.Title>

					<p class="cancel-dialog-desc">
						This location will be included in the calendar ICS and email notifications sent to the
						guest.
					</p>

					<form method="POST" action="/admin/appointment/{data.appointment.id}?/edit">
						<input
							type="text"
							name="location"
							class="cancel-reason-input"
							placeholder="e.g., Google Meet, Phone call, Office address"
							maxlength="200"
							bind:value={editLocationValue}
							bind:this={locationInputEl}
						/>
						<div class="cancel-dialog-actions edit-note-actions">
							<button type="submit" class="cancel-confirm-btn">Save</button>
							{#if data.appointment.location}
								<button
									type="submit"
									class="delete-note-btn"
									onclick={() => {
										editLocationValue = '';
									}}
								>
									Delete
								</button>
							{/if}
							<Dialog.Close>
								{#snippet child({ props: closeProps })}
									<button {...closeProps} type="button" class="cancel-cancel-btn">Close</button>
								{/snippet}
							</Dialog.Close>
						</div>
					</form>
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<Dialog.Root bind:open={editVideoChatDialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="dialog-overlay"></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content>
			{#snippet child({ props })}
				<div {...props} class="dialog-content cancel-dialog">
					<Dialog.Title>
						{#snippet child({ props: titleProps })}
							<h2 {...titleProps} class="cancel-dialog-title">
								{#if data.appointment.video_chat}Edit Video Link{:else}Add Video Link{/if}
							</h2>
						{/snippet}
					</Dialog.Title>

					<p class="cancel-dialog-desc">
						This link will be included in the calendar invitation and email notifications sent to
						the guest.
					</p>

					<form method="POST" action="/admin/appointment/{data.appointment.id}?/edit">
						<input
							type="url"
							name="video_chat"
							class="cancel-reason-input"
							placeholder="e.g., https://zoom.us/j/..."
							bind:value={editVideoChatValue}
							bind:this={videoChatInputEl}
						/>
						<div class="cancel-dialog-actions edit-note-actions">
							<button type="submit" class="cancel-confirm-btn">Save</button>
							{#if data.appointment.video_chat}
								<button
									type="submit"
									class="delete-note-btn"
									onclick={() => {
										editVideoChatValue = '';
									}}
								>
									Delete
								</button>
							{/if}
							<Dialog.Close>
								{#snippet child({ props: closeProps })}
									<button {...closeProps} type="button" class="cancel-cancel-btn">Close</button>
								{/snippet}
							</Dialog.Close>
						</div>
					</form>
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-6) var(--space-10);
		color: var(--text);
	}

	/* Full-bleed page nav; empty for guests, holds the back arrow for admins. */
	.page-nav {
		display: flex;
		align-items: center;
		height: 56px;
		padding: 0 var(--space-6);
	}

	/* ---- banners (notices & confirmations) ---- */
	.banner {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-6);
		border: 1px solid;
		border-radius: var(--radius-md);
		margin: var(--space-4) 0;
		color: var(--text-secondary);
		font-size: var(--font-size-md);
		line-height: 1.5;
	}

	.banner-icon {
		font-size: var(--font-size-xl);
		flex-shrink: 0;
		margin-top: 2px;
		display: inline-flex;
	}

	.banner-text {
		margin: 0;
	}

	.banner-danger {
		background: var(--danger-bg);
		border-color: var(--danger-border);
	}

	.banner-danger .banner-icon {
		color: var(--danger);
	}

	.banner-info {
		background: var(--info-bg);
		border-color: var(--info-border);
	}

	.banner-info .banner-icon {
		color: var(--info-strong);
	}

	/* ---- card ---- */
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.card-section {
		padding: var(--space-6) var(--space-7);
	}

	.card-section + .card-section {
		border-top: 1px solid var(--border);
	}

	.card-section-header {
		background: var(--surface-muted);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.event-heading {
		min-width: 0;
	}

	/* ---- state stripe (the appointment's single state line) ---- */
	.card-state {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-7);
		font-size: var(--font-size-lg);
		font-weight: 600;
	}

	.state-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-pill);
		background: currentColor;
		flex-shrink: 0;
		margin-top: 8px;
	}

	.state-meta {
		margin-left: auto;
		font-size: var(--font-size-base);
		font-weight: 500;
	}

	.state-meta-link {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.state-meta-link:hover {
		text-decoration: none;
	}

	.state-info {
		background: var(--info-bg);
		color: var(--info-strong);
	}

	.state-active {
		background: var(--success-bg);
		color: var(--success-strong);
	}

	.state-warning {
		background: var(--warning-bg);
		color: var(--warning-strong);
	}

	.state-danger {
		background: var(--danger-bg);
		color: var(--danger-strong);
	}

	.state-quiet {
		background: var(--quiet-bg);
		color: var(--quiet-strong);
	}

	@media (prefers-color-scheme: dark) {
		.state-info {
			color: var(--info);
		}
		.state-active {
			color: var(--success);
		}
		.state-warning {
			color: var(--warning);
		}
		.state-danger {
			color: var(--danger);
		}
		.state-quiet {
			color: var(--quiet);
		}
	}

	.event-name {
		font-size: var(--font-size-2xl);
		font-weight: 700;
		margin: 0 0 var(--space-2);
	}

	.event-meta {
		color: var(--text-muted);
		font-size: var(--font-size-base);
		margin: 0;
	}

	.card-section.detail-list {
		padding: var(--space-4) 0;
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.detail-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-7);
		box-sizing: border-box;
	}

	.detail-icon {
		font-size: var(--font-size-xl);
		color: var(--text-muted);
		flex-shrink: 0;
		margin-top: 1px;
		display: inline-flex;
	}

	.detail-text {
		min-width: 0;
	}

	.detail-primary {
		color: var(--text);
		font-weight: 500;
		font-size: var(--font-size-lg);
		line-height: 1.4;
	}

	.detail-secondary {
		color: var(--text-muted);
		font-size: var(--font-size-base);
		margin-top: 2px;
	}

	.detail-secondary a {
		color: var(--primary);
		text-decoration: underline;
		word-break: break-all;
	}

	.detail-secondary a:hover {
		opacity: 0.8;
	}

	.action-arrow {
		display: inline-flex;
		transition: transform var(--transition);
	}

	/* ---- accept / decline CTA (pending, host) ---- */
	.decide-cta {
		display: flex;
		gap: var(--space-4);
	}

	.decide-form {
		flex: 1;
	}

	.decide-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: 48px;
		padding: var(--space-4) var(--space-6);
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition:
			opacity var(--transition),
			background var(--transition),
			border-color var(--transition);
	}

	.decide-accept {
		border: none;
		background: var(--primary);
		color: var(--text-on-primary);
	}

	.decide-accept:hover {
		opacity: 0.9;
	}

	.decide-decline {
		border: 1px solid var(--border-strong);
		background: var(--surface);
		color: var(--text-secondary);
	}

	.decide-decline:hover {
		background: var(--danger-bg);
		border-color: var(--danger-border);
		color: var(--danger-strong);
	}

	/* ---- rebook CTA (declined / cancelled) ---- */
	.rebook {
		margin-top: var(--space-8);
		display: flex;
		justify-content: center;
	}

	.rebook-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-7);
		background: var(--primary);
		color: var(--text-on-primary);
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		font-weight: 600;
		text-decoration: none;
		transition: opacity var(--transition);
	}

	.rebook-btn:hover {
		opacity: 0.9;
	}

	.rebook-btn:hover .action-arrow {
		transform: translateX(2px);
	}

	@media (max-width: 768px) {
		.page {
			padding: var(--space-5) var(--space-5) var(--space-9);
		}

		.page-nav {
			padding: 0 var(--space-5);
		}

		.page.has-cta {
			padding-bottom: calc(var(--space-10) + var(--space-8) + env(safe-area-inset-bottom));
		}

		.card-section {
			padding: var(--space-5) var(--space-5);
		}

		.card-cta {
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			z-index: 50;
			padding: var(--space-4) var(--space-5);
			padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
			background: var(--surface);
			border-top: 1px solid var(--border);
			box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);
		}

		.rebook-btn {
			width: 100%;
			justify-content: center;
			min-height: 56px;
		}

		.card-section.detail-list {
			padding: var(--space-3) 0;
		}

		.detail-row,
		.detail-row-button {
			padding: var(--space-3) var(--space-5);
		}
	}

	/* ---- cancel dialog ---- */
	.dialog-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 200;
	}

	.dialog-content.cancel-dialog {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 201;
		display: flex;
		flex-direction: column;
		max-height: 80vh;
		background: var(--surface);
		border-top: 1px solid var(--border);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
		padding: var(--space-6);
		gap: var(--space-5);
		box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12);
		animation: cancel-slide-up 0.12s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@media (min-width: 769px) {
		.dialog-content.cancel-dialog {
			top: 50%;
			bottom: auto;
			left: 50%;
			right: auto;
			width: 440px;
			max-width: calc(100vw - var(--space-7) * 2);
			max-height: min(70vh, 520px);
			transform: translate(-50%, -50%);
			border: 1px solid var(--border);
			border-radius: var(--radius-md);
			animation: none;
		}
	}

	@keyframes cancel-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes cancel-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes cancel-fade-up-desktop {
		from {
			transform: translate(-50%, calc(-50% + 15px));
		}
		to {
			transform: translate(-50%, -50%);
		}
	}

	.cancel-dialog-title {
		margin: 0;
		font-size: var(--font-size-xl);
		font-weight: 700;
	}

	.cancel-dialog-desc {
		color: var(--text-secondary);
		font-size: var(--font-size-md);
		line-height: 1.5;
		margin: 0;
	}

	.cancel-dialog-actions {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		margin-top: var(--space-2);
	}

	.cancel-confirm-btn {
		background: var(--danger);
		color: var(--text-on-primary);
		border: 1px solid var(--danger);
		border-radius: var(--radius);
		padding: var(--space-3) var(--space-6);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
		transition:
			background var(--transition),
			border-color var(--transition);
	}

	.cancel-confirm-btn:hover {
		background: var(--danger-strong);
		border-color: var(--danger-strong);
	}

	.cancel-cancel-btn {
		background: none;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		padding: var(--space-3) var(--space-6);
		font-size: var(--font-size-md);
		font-weight: 600;
		color: var(--text);
		cursor: pointer;
		transition: background var(--transition);
	}

	.cancel-cancel-btn:hover {
		background: var(--surface-muted);
	}

	.cancel-reason-input {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		font-family: inherit;
		resize: vertical;
		box-sizing: border-box;
		margin-bottom: var(--space-4);
		background: var(--surface);
		color: var(--text);
	}

	.cancel-reason-input:focus {
		outline: none;
		border-color: var(--primary);
		box-shadow: 0 0 0 2px var(--primary-alpha);
	}

	@media (max-width: 768px) {
		.cancel-dialog-actions {
			flex-direction: column;
			align-items: stretch;
			gap: var(--space-3);
		}

		.cancel-confirm-btn {
			width: 100%;
			text-align: center;
			min-height: 48px;
		}

		.cancel-cancel-btn {
			width: 100%;
			text-align: center;
			min-height: 48px;
		}
	}

	.tz-extra {
		margin-top: var(--space-2);
	}

	/* One note per line: "Host: (reschedule) reason". Notes stack vertically. */
	.note-line {
		line-height: 1.5;
	}

	.note-line + .note-line {
		margin-top: var(--space-2);
	}

	/* ---- centered page header ---- */
	.page-header-container {
		text-align: center;
		margin: 0 0 var(--space-10);
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.page-header-icon {
		font-size: 48px;
		display: inline-flex;
		line-height: 1;
		margin-bottom: var(--space-4);
	}

	.page-header-icon.status-info {
		color: var(--info-strong);
	}

	.page-header-icon.status-active {
		color: var(--success-strong);
	}

	.page-header-icon.status-warning {
		color: var(--warning-strong);
	}

	.page-header-icon.status-danger {
		color: var(--danger-strong);
	}

	.page-header-icon.status-quiet {
		color: var(--quiet-strong);
	}

	.page-header-title {
		font-size: calc(var(--font-size-3xl) * 1.5);
		font-weight: 700;
		color: var(--text);
		margin: 0 0 var(--space-1);
	}

	.page-header-desc {
		font-size: calc(var(--font-size-lg) * 1.25);
		color: var(--text-secondary);
		max-width: 480px;
		margin: 0 auto;
		line-height: 1.5;
	}

	.detail-row-button {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		width: 100%;
		border: none;
		background: none;
		text-align: left;
		font-family: inherit;
		padding: var(--space-3) var(--space-7);
		border-radius: 0;
		cursor: pointer;
		color: inherit;
		transition: background-color var(--transition);
		box-sizing: border-box;
	}

	.detail-row-button:hover {
		background-color: var(--surface-muted);
	}

	.detail-edit-icon {
		margin-left: auto;
		align-self: center;
		display: inline-flex;
		color: var(--text-muted);
		transition: color var(--transition);
	}

	.detail-row-button:hover .detail-edit-icon {
		color: var(--text);
	}

	.delete-note-btn {
		background: none;
		border: 1px solid var(--danger-border);
		border-radius: var(--radius);
		padding: var(--space-3) var(--space-6);
		font-size: var(--font-size-md);
		font-weight: 600;
		color: var(--danger-strong);
		cursor: pointer;
		transition: background var(--transition);
	}

	.delete-note-btn:hover {
		background: var(--danger-bg);
	}

	.edit-note-actions .cancel-cancel-btn {
		margin-left: auto;
	}

	.state-info-group {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.state-notes {
		margin-top: var(--space-1);
		font-size: var(--font-size-base);
		font-weight: 500;
		line-height: 1.4;
	}

	.state-note-line {
		color: inherit;
	}

	:global(.questions-section[open] + .log-section) {
		border-top: none;
	}
</style>
