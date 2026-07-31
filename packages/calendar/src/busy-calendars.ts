import type { Meeting } from '@when/config';

/**
 * Every calendar whose events block this meeting's slots. The booking calendar is
 * always among them — a calendar we write appointments into holds events that are
 * conflicts too — and `additional_busy_calendars` names any further ones to consult.
 * Booking calendar first, de-duplicated, config order otherwise preserved.
 */
export function busyCalendarsFor(
	meeting: Pick<Meeting, 'booking_calendar' | 'additional_busy_calendars'>
): string[] {
	return [...new Set([meeting.booking_calendar, ...(meeting.additional_busy_calendars ?? [])])];
}
