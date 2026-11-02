<script lang="ts">
	import { navigating } from '$app/state';
	import { onMount } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion, Tween } from 'svelte/motion';

	const MIN_DISPLAY_MS = 200;
	const FINISH_MS = 200;
	const FRESH_MS = 5000;
	const STORAGE_KEY = 'when.navigation-pending';

	let visible = $state(false);
	let startedAt = 0;
	let completionTimer: ReturnType<typeof setTimeout> | undefined;
	let resumeFrame: number | undefined;
	const progress = new Tween(0, { easing: cubicOut });

	function cancelCompletion() {
		clearTimeout(completionTimer);
		completionTimer = undefined;
		if (resumeFrame !== undefined) {
			cancelAnimationFrame(resumeFrame);
			resumeFrame = undefined;
		}
		progress.set(progress.current, { duration: 0 });
	}

	function finish(reducedMotion: boolean) {
		clearTimeout(completionTimer);
		progress.set(100, { duration: reducedMotion ? 0 : FINISH_MS });
		completionTimer = setTimeout(() => {
			visible = false;
			startedAt = 0;
		}, FINISH_MS);
	}

	$effect(() => {
		const reducedMotion = prefersReducedMotion.current;
		if (navigating.to) {
			visible = true;
			startedAt = Date.now();
			progress.set(20, { duration: 0 });
			progress.set(90, { duration: reducedMotion ? 0 : 10000 });
		} else if (startedAt > 0) {
			const remaining = Math.max(0, MIN_DISPLAY_MS - (Date.now() - startedAt));
			completionTimer = setTimeout(() => finish(reducedMotion), remaining);
		}
		return cancelCompletion;
	});

	onMount(() => {
		function restorePendingNavigation() {
			let pending: string | null;
			try {
				pending = sessionStorage.getItem(STORAGE_KEY);
				sessionStorage.removeItem(STORAGE_KEY);
			} catch {
				return;
			}
			if (!pending) return;
			const age = Date.now() - Number(pending);
			if (!Number.isFinite(age) || age < 0 || age > FRESH_MS || navigating.to) return;

			cancelCompletion();
			visible = true;
			startedAt = Date.now();
			progress.set(90, { duration: 0 });
			resumeFrame = requestAnimationFrame(() => {
				resumeFrame = undefined;
				finish(prefersReducedMotion.current);
			});
		}

		function markPendingNavigation() {
			try {
				sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
			} catch {
				// Navigation feedback still works when storage is unavailable.
			}
		}

		function restoreFromHistory(event: PageTransitionEvent) {
			if (event.persisted) restorePendingNavigation();
		}

		restorePendingNavigation();
		window.addEventListener('pagehide', markPendingNavigation);
		window.addEventListener('pageshow', restoreFromHistory);
		return () => {
			window.removeEventListener('pagehide', markPendingNavigation);
			window.removeEventListener('pageshow', restoreFromHistory);
			cancelCompletion();
		};
	});
</script>

{#if visible}
	<div class="navigation-progress" role="progressbar" aria-label="Loading page">
		<div class="fill" style:transform={`scaleX(${progress.current / 100})`}></div>
	</div>
{/if}

<style>
	.navigation-progress {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 100;
		height: var(--space-1);
		pointer-events: none;
		overflow: hidden;
	}

	.fill {
		width: 100%;
		height: 100%;
		background: var(--when-color-primary);
		transform-origin: left;
	}
</style>
