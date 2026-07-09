<script lang="ts">
	import { Calendar } from 'bits-ui';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import IconCaretRight from 'virtual:icons/ph/caret-right';
	import type { AppointmentFlow } from '$lib/appointmentFlow.svelte';

	interface Props {
		flow: AppointmentFlow;
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

<section class="calendar-panel">
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
</section>

<style>
	.calendar-panel {
		width: 100%;
	}
</style>
