import { expect, test } from 'vitest';
import { busyCalendarsFor } from './busy-calendars.js';

test('the booking calendar is busy even when none are listed', () => {
	expect(busyCalendarsFor({ booking_calendar: 'personal' })).toEqual(['personal']);
});

test('treats an empty list the same as an absent one', () => {
	expect(busyCalendarsFor({ booking_calendar: 'personal', additional_busy_calendars: [] })).toEqual(
		['personal']
	);
});

test('adds listed calendars after the booking calendar', () => {
	expect(
		busyCalendarsFor({
			booking_calendar: 'personal',
			additional_busy_calendars: ['work', 'family']
		})
	).toEqual(['personal', 'work', 'family']);
});

test('de-duplicates a booking calendar that is also listed', () => {
	expect(
		busyCalendarsFor({
			booking_calendar: 'personal',
			additional_busy_calendars: ['work', 'personal']
		})
	).toEqual(['personal', 'work']);
});
