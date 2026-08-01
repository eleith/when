import { describe, expect, test } from 'vitest';
import {
	timeAgo,
	formatDate,
	formatDateCompact,
	formatDateShort,
	formatWeekday,
	formatTime,
	formatTimeShort,
	formatTimeRange,
	formatSlot,
	formatTimestamp,
	instantToDateKey,
	tzCity,
	tzOffset,
	formatTzShort,
	formatTzAbbrev
} from './datetime';

// Output strings assume the en-US default locale (matches dev + CI). Timezone
// cases use UTC and a non-DST zone (Asia/Kolkata) so offsets don't shift with
// the season; the one DST zone (America/New_York) is exercised in June, when
// it is unambiguously on EDT.
const ISO = '2025-06-15T09:30:00Z'; // a Sunday
const ISO_END = '2025-06-15T10:00:00Z';

describe('instantToDateKey', () => {
	test('returns the day key in the given timezone', () => {
		expect(instantToDateKey(ISO, 'UTC')).toBe('2025-06-15');
		expect(instantToDateKey(ISO, 'Asia/Kolkata')).toBe('2025-06-15');
	});

	test('shifts the day when the timezone crosses midnight', () => {
		// 02:30Z is the previous evening (22:30) in America/New_York (EDT).
		expect(instantToDateKey('2025-06-15T02:30:00Z', 'America/New_York')).toBe('2025-06-14');
	});

	test('returns the input unchanged on bad data', () => {
		expect(instantToDateKey('nope', 'UTC')).toBe('nope');
	});
});

describe('formatDate', () => {
	test('renders a YYYY-MM-DD key as a long date', () => {
		expect(formatDate('2025-06-15')).toBe('Sunday, June 15');
	});

	test('returns the key unchanged when it is not a valid date', () => {
		expect(formatDate('nope')).toBe('nope');
	});
});

describe('formatDateCompact', () => {
	test('renders a YYYY-MM-DD key as a compact date', () => {
		expect(formatDateCompact('2025-06-15')).toBe('Sun, Jun 15');
	});

	test('returns the key unchanged when it is not a valid date', () => {
		expect(formatDateCompact('nope')).toBe('nope');
	});
});

describe('formatDateShort', () => {
	test('renders a numeric date in the given timezone', () => {
		expect(formatDateShort(ISO, 'UTC')).toBe('6/15/2025');
	});

	test('rolls to the previous day for a zone behind UTC', () => {
		expect(formatDateShort('2025-06-15T02:00:00Z', 'America/New_York')).toBe('6/14/2025');
	});

	test('returns the input unchanged on bad data', () => {
		expect(formatDateShort('nope', 'UTC')).toBe('nope');
	});
});

describe('formatWeekday', () => {
	test('renders the weekday in the given timezone', () => {
		expect(formatWeekday(ISO, 'UTC')).toBe('Sunday');
	});

	test('returns an empty string on bad data', () => {
		expect(formatWeekday('nope', 'UTC')).toBe('');
	});
});

describe('formatTime', () => {
	test('renders the time in UTC', () => {
		expect(formatTime(ISO, 'UTC')).toBe('09:30 AM');
	});

	test('shifts the time for a different timezone', () => {
		expect(formatTime(ISO, 'America/New_York')).toBe('05:30 AM');
	});

	test('returns the input unchanged on bad data', () => {
		expect(formatTime('nope', 'UTC')).toBe('nope');
	});
});

describe('formatTimeShort', () => {
	test('drops the leading zero and lowercases the meridiem', () => {
		expect(formatTimeShort(ISO, 'UTC')).toBe('9:30am');
		expect(formatTimeShort('2025-06-15T13:00:00Z', 'UTC')).toBe('1:00pm');
	});

	test('shifts the time for a different timezone', () => {
		expect(formatTimeShort(ISO, 'America/New_York')).toBe('5:30am');
	});

	test('returns the input unchanged on bad data', () => {
		expect(formatTimeShort('nope', 'UTC')).toBe('nope');
	});
});

describe('formatTimeRange', () => {
	test('joins start and end with an en dash', () => {
		expect(formatTimeRange(ISO, ISO_END, 'UTC')).toBe('09:30 AM – 10:00 AM');
	});

	test('falls back to the raw values on bad data', () => {
		expect(formatTimeRange('a', 'b', 'UTC')).toBe('a – b');
	});
});

describe('formatSlot', () => {
	test('renders weekday, date, and time', () => {
		expect(formatSlot(ISO, 'UTC')).toBe('Sun, Jun 15, 09:30 AM');
	});

	test('returns the input unchanged on bad data', () => {
		expect(formatSlot('nope', 'UTC')).toBe('nope');
	});
});

describe('formatTimestamp', () => {
	test('renders a zero-padded log-style timestamp in the given timezone', () => {
		expect(formatTimestamp(ISO, 'UTC')).toBe('2025-06-15 09:30:00');
	});

	test('shifts to the local wall clock of the timezone', () => {
		expect(formatTimestamp(ISO, 'America/New_York')).toBe('2025-06-15 05:30:00');
	});

	test('returns the input unchanged on bad data', () => {
		expect(formatTimestamp('nope', 'UTC')).toBe('nope');
	});
});

describe('tzCity', () => {
	test('takes the last path segment and unslugs underscores', () => {
		expect(tzCity('America/New_York')).toBe('New York');
		expect(tzCity('Asia/Kolkata')).toBe('Kolkata');
	});

	test('returns single-segment zones as-is', () => {
		expect(tzCity('UTC')).toBe('UTC');
	});
});

describe('tzOffset', () => {
	test('returns the short UTC offset', () => {
		expect(tzOffset('UTC')).toBe('GMT+0');
		expect(tzOffset('Asia/Kolkata')).toBe('GMT+5:30');
	});

	test('returns an empty string for an unknown zone', () => {
		expect(tzOffset('Not/AZone')).toBe('');
	});
});

describe('formatTzShort', () => {
	test('composes city and offset', () => {
		expect(formatTzShort('UTC')).toBe('UTC · GMT+0');
		expect(formatTzShort('Asia/Kolkata')).toBe('Kolkata · GMT+5:30');
	});

	test('falls back to the city alone when there is no offset', () => {
		expect(formatTzShort('Not/AZone')).toBe('AZone');
	});
});

describe('formatTzAbbrev', () => {
	test('renders the season-aware abbreviation for the instant', () => {
		// June is unambiguously EDT, not EST.
		expect(formatTzAbbrev(ISO, 'America/New_York')).toBe('EDT');
		expect(formatTzAbbrev(ISO, 'UTC')).toBe('UTC');
	});

	test('returns an empty string on bad data', () => {
		expect(formatTzAbbrev('nope', 'America/New_York')).toBe('');
	});
});

const agoNow = Date.parse('2026-08-01T12:00:00Z');
const ago = (seconds: number) => timeAgo(new Date(agoNow - seconds * 1000).toISOString(), agoNow);

test('seconds read as "just now" rather than a count', () => {
	expect(ago(5)).toBe('just now');
});

test('picks the largest unit that fits', () => {
	expect(ago(90)).toBe('2 minutes ago');
	expect(ago(3 * 3600)).toBe('3 hours ago');
	expect(ago(5 * 86400)).toBe('5 days ago');
	expect(ago(86400)).toBe('1 day ago');
	expect(ago(3 * 604800)).toBe('3 weeks ago');
	expect(ago(400 * 86400)).toBe('1 year ago');
});

test('a clock skewed into the future does not read as negative', () => {
	expect(ago(-30)).toBe('just now');
});

test('a missing timestamp reads as unknown, not as a bad date', () => {
	expect(timeAgo(null)).toBe('unknown');
});
