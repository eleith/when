import { describe, expect, test } from 'vitest';
import {
	formatDate,
	formatDateShort,
	formatWeekday,
	formatTime,
	formatTimeRange,
	formatSlot,
	tzCity,
	tzOffset,
	formatTzShort
} from './datetime';

// Output strings assume the en-US default locale (matches dev + CI). Timezone
// cases use UTC and a non-DST zone (Asia/Kolkata) so offsets don't shift with
// the season; the one DST zone (America/New_York) is exercised in June, when
// it is unambiguously on EDT.
const ISO = '2025-06-15T09:30:00Z'; // a Sunday
const ISO_END = '2025-06-15T10:00:00Z';

describe('formatDate', () => {
	test('renders a YYYY-MM-DD key as a long date', () => {
		expect(formatDate('2025-06-15')).toBe('Sunday, June 15');
	});

	test('returns the key unchanged when it is not a valid date', () => {
		expect(formatDate('nope')).toBe('nope');
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
