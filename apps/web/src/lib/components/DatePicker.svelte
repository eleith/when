<script lang="ts">
	import { Calendar } from 'bits-ui';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import IconCaretRight from 'virtual:icons/ph/caret-right';
	import type { BookingFlow } from '$lib/bookingFlow.svelte';

	interface Props {
		flow: BookingFlow;
	}

	let { flow }: Props = $props();

	function dateToStr(d: DateValue): string {
		return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
	}

	function strToCalendarDate(key: string): CalendarDate {
		return new CalendarDate(
			Number(key.slice(0, 4)),
			Number(key.slice(5, 7)),
			Number(key.slice(8, 10))
		);
	}

	let calendarValue = $derived(flow.viewDate ? strToCalendarDate(flow.viewDate) : undefined);

	const todayKey = new Date().toISOString().slice(0, 10);

	function isDateUnavailable(date: DateValue): boolean {
		return !flow.availableDates.has(dateToStr(date));
	}

	function isDateDisabled(date: DateValue): boolean {
		return dateToStr(date) < todayKey;
	}

	function onDateChange(date: DateValue | undefined) {
		flow.selectDate(date ? dateToStr(date) : null);
	}
</script>

<div class="calendar-panel">
	<Calendar.Root
		type="single"
		fixedWeeks
		weekdayFormat="short"
		{isDateUnavailable}
		{isDateDisabled}
		value={calendarValue}
		onValueChange={onDateChange}
	>
		{#snippet children({ months, weekdays })}
			<Calendar.Header class="cal-header">
				<Calendar.Heading class="cal-heading" />
				<div class="cal-nav">
					<Calendar.PrevButton class="cal-nav-btn"
						><IconCaretLeft aria-hidden="true" /></Calendar.PrevButton
					>
					<Calendar.NextButton class="cal-nav-btn"
						><IconCaretRight aria-hidden="true" /></Calendar.NextButton
					>
				</div>
			</Calendar.Header>
			<Calendar.Grid class="cal-grid">
				<Calendar.GridHead>
					<Calendar.GridRow class="cal-weekdays">
						{#each weekdays as day (day)}
							<Calendar.HeadCell class="cal-weekday">{day.slice(0, 2)}</Calendar.HeadCell>
						{/each}
					</Calendar.GridRow>
				</Calendar.GridHead>
				<Calendar.GridBody>
					{#each months as month (month.value.toString())}
						{#each month.weeks as weekDates, wi (wi)}
							<Calendar.GridRow class="cal-row">
								{#each weekDates as date (date.toString())}
									<Calendar.Cell {date} month={month.value} class="cal-cell">
										<Calendar.Day class="cal-day">{date.day}</Calendar.Day>
									</Calendar.Cell>
								{/each}
							</Calendar.GridRow>
						{/each}
					{/each}
				</Calendar.GridBody>
			</Calendar.Grid>
		{/snippet}
	</Calendar.Root>
</div>

<style>
	.calendar-panel {
		width: 100%;
	}

	/* ---- calendar (Bits UI) ---- */
	.calendar-panel :global(.cal-header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-7);
	}

	.calendar-panel :global(.cal-heading) {
		font-weight: 600;
		font-size: var(--font-size-xl);
		color: var(--text);
	}

	.calendar-panel :global(.cal-nav) {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.calendar-panel :global(.cal-nav-btn) {
		background: none;
		border: none;
		font-size: var(--font-size-xl);
		color: var(--text-muted);
		cursor: pointer;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
		line-height: 1;
	}

	.calendar-panel :global(.cal-nav-btn:hover) {
		background: var(--surface-muted);
		color: var(--text);
	}

	.calendar-panel :global(.cal-grid) {
		width: 100%;
		max-width: 360px;
		margin: 0 auto;
		user-select: none;
	}

	.calendar-panel :global(.cal-weekdays) {
		display: flex;
		width: 100%;
		background: var(--surface-muted);
		border-radius: var(--radius-sm);
		margin-bottom: var(--space-2);
	}

	.calendar-panel :global(.cal-weekday) {
		flex: 1;
		text-align: center;
		font-size: var(--font-size-xs);
		color: var(--text-disabled);
		font-weight: 600;
		text-transform: uppercase;
		padding: var(--space-2) 0;
	}

	.calendar-panel :global(.cal-row) {
		display: flex;
		width: 100%;
	}

	.calendar-panel :global(.cal-cell) {
		flex: 1;
		padding: 0;
	}

	.calendar-panel :global(.cal-day) {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		font-size: var(--font-size-sm);
		border: none;
		background: none;
		cursor: pointer;
		border-radius: var(--radius);
		color: var(--text);
		transition: background var(--transition);
		position: relative;
		width: 100%;
	}

	.calendar-panel :global(.cal-day:hover:not([data-disabled]):not([data-selected])) {
		background: var(--surface-muted);
	}

	.calendar-panel :global(.cal-day[data-unavailable]) {
		color: var(--border-strong);
		cursor: default;
	}

	.calendar-panel :global(.cal-day[data-disabled]) {
		color: var(--border-strong);
		cursor: default;
	}

	.calendar-panel
		:global(.cal-day:not([data-unavailable]):not([data-disabled]):not([data-selected])) {
		font-weight: 600;
		color: var(--text);
	}

	.calendar-panel
		:global(.cal-day:not([data-unavailable]):not([data-disabled]):not([data-selected]):hover) {
		background: var(--primary-muted);
	}

	.calendar-panel :global(.cal-day[data-today]:not([data-selected])::after) {
		content: '';
		position: absolute;
		bottom: var(--space-3);
		left: 50%;
		transform: translateX(-50%);
		width: var(--space-2);
		height: var(--space-2);
		border-radius: 50%;
		background: var(--border-strong);
	}

	.calendar-panel :global(.cal-day[data-selected]) {
		background: var(--primary-muted);
		color: var(--primary);
	}

	.calendar-panel :global(.cal-day[data-selected][data-today]::after) {
		background: var(--primary);
	}

	.calendar-panel :global(.cal-day:focus-visible) {
		outline: 2px solid var(--primary);
		outline-offset: -2px;
	}

	.calendar-panel :global(.cal-day[data-outside-month]) {
		visibility: hidden;
	}
</style>
