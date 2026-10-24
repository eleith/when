<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { deserialize } from '$app/forms';
	import { untrack } from 'svelte';

	interface Props {
		open?: boolean;
		appointmentId: string;
		currentDuration: number;
		durations: number[];
	}

	let { open = $bindable(false), appointmentId, currentDuration, durations }: Props = $props();
	const durationId = $props.id();

	type Outcome = 'editing' | 'duration_changed' | 'no_change' | 'updates_unconfirmed' | 'uncertain';

	let draft = $state(0);
	let choices = $state<number[]>([]);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let outcome = $state<Outcome>('editing');

	$effect(() => {
		if (open) {
			// Read projected choices only on opening, not when props change.
			untrack(() => {
				draft = currentDuration;
				choices = [...durations];
				error = null;
				outcome = 'editing';
			});
		}
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (saving || outcome !== 'editing') return;

		saving = true;
		error = null;
		const form = new FormData();
		form.set('duration', String(draft));

		try {
			let result: ReturnType<typeof deserialize>;
			try {
				const response = await fetch(`/admin/appointment/${appointmentId}?/changeDuration`, {
					method: 'POST',
					headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
					body: form
				});
				const body = await response.text();
				result = deserialize(body);
			} catch {
				outcome = 'uncertain';
				return;
			}

			if (
				result?.type === 'success' &&
				(result.data?.success === 'duration_changed' || result.data?.success === 'no_change')
			) {
				outcome = result.data.success;
			} else if (result?.type === 'failure' && result.data?.durationSaved === true) {
				outcome = 'updates_unconfirmed';
			} else if (result?.type === 'failure' && typeof result.data?.error === 'string') {
				error = result.data.error;
				return;
			} else {
				// Redirects, error envelopes and unrecognized data do not establish whether a write happened.
				outcome = 'uncertain';
				return;
			}
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root
	bind:open={
		() => open,
		(value) => {
			if (!saving && outcome === 'editing') open = value;
		}
	}
>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="dialog-overlay"></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content>
			{#snippet child({ props })}
				<div {...props} class="duration-editor">
					<Dialog.Title>
						{#snippet child({ props: titleProps })}
							<h2 {...titleProps}>Change duration</h2>
						{/snippet}
					</Dialog.Title>
					<Dialog.Description>
						{#snippet child({ props: descriptionProps })}
							<p {...descriptionProps}>
								The start time stays the same. Calendar and email updates will be requested when the
								duration changes.
							</p>
						{/snippet}
					</Dialog.Description>

					<form onsubmit={save} aria-busy={saving}>
						<label for={durationId}>Duration</label>
						<select
							id={durationId}
							name="duration"
							bind:value={draft}
							disabled={saving || outcome !== 'editing'}
						>
							{#each choices as minutes (minutes)}
								<option value={minutes}>{minutes} minutes</option>
							{/each}
						</select>

						{#if error}
							<p class="error" role="alert">{error}</p>
						{/if}
						{#if outcome === 'duration_changed'}
							<p role="status">Duration saved.</p>
						{:else if outcome === 'no_change'}
							<p role="status">Duration unchanged.</p>
						{:else if outcome === 'updates_unconfirmed'}
							<p class="warning" role="alert">
								The duration was saved, but calendar and email update submission could not be
								confirmed.
							</p>
						{:else if outcome === 'uncertain'}
							<p class="warning" role="alert">
								Could not confirm whether the duration was saved. Reload the page to check before
								making another change.
							</p>
						{/if}

						<div class="dialog-actions">
							{#if outcome === 'editing'}
								<button type="submit" class="save" disabled={saving}>
									{#if saving}Saving…{:else}Save{/if}
								</button>
								<Dialog.Close>
									{#snippet child({ props: closeProps })}
										<button {...closeProps} type="button" disabled={saving}>Close</button>
									{/snippet}
								</Dialog.Close>
							{:else}
								<button type="button" disabled={saving} onclick={() => window.location.reload()}>
									{#if outcome === 'uncertain'}Reload to check{:else if outcome === 'updates_unconfirmed'}Reload
										appointment{:else}Done{/if}
								</button>
							{/if}
						</div>
					</form>
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.dialog-overlay {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--when-color-text) 40%, transparent);
		z-index: 200;
	}

	.duration-editor {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 201;
		box-sizing: border-box;
		width: min(calc(100vw - var(--space-7) * 2), calc(var(--space-10) * 7));
		max-height: calc(100dvh - var(--space-7) * 2);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-6);
		border: var(--space-1) solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--when-color-text);
		box-shadow: var(--shadow-card);
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-xl);
	}

	p {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: var(--font-size-md);
		line-height: 1.5;
	}

	form,
	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		font-size: var(--font-size-md);
	}

	select,
	button {
		min-height: calc(var(--space-8) + var(--space-4));
		padding: var(--space-3) var(--space-5);
		border: var(--space-1) solid var(--color-border-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--when-color-text);
		font: inherit;
	}

	button {
		cursor: pointer;
		font-weight: 600;
	}

	button:hover:not(:disabled) {
		background: var(--color-surface-muted);
	}

	button.save {
		background: var(--when-color-primary);
		border-color: var(--when-color-primary);
		color: var(--when-color-text-on-primary);
	}

	button.save:hover:not(:disabled) {
		background: var(--when-color-primary);
	}

	button:disabled,
	select:disabled {
		cursor: not-allowed;
		color: var(--color-text-disabled);
	}

	button:focus-visible,
	select:focus-visible {
		outline: var(--space-1) solid var(--when-color-primary);
		outline-offset: var(--space-1);
		box-shadow: var(--shadow-focus);
	}

	.dialog-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.error,
	.warning {
		padding: var(--space-4);
		border: var(--space-1) solid var(--color-danger-border);
		border-radius: var(--radius);
		background: var(--color-danger-bg);
		color: var(--color-danger-strong);
	}

	.warning {
		border-color: var(--color-warning-border);
		background: var(--color-warning-bg);
		color: var(--color-warning-strong);
	}
</style>
