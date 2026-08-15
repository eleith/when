import { describe, test, expect } from 'vitest';
import { buildTimezoneEntry, getTimezoneIndex, searchTimezones } from '$lib/timezones';

describe('buildTimezoneEntry', () => {
	test('extracts city, offset, and timezone name for America/Los_Angeles', () => {
		const entry = buildTimezoneEntry('America/Los_Angeles');
		expect(entry.tz).toBe('America/Los_Angeles');
		expect(entry.city).toBe('Los Angeles');
		expect(entry.tzName).toMatch(/Pacific Time|Pacific Standard Time|Pacific Daylight Time/);
		expect(entry.offset).toMatch(/^GMT[+-]\d+/);
		expect(entry.tokens).toContain('los angeles');
		expect(entry.tokens).toContain('america');
		expect(entry.tokens).toContain('pst');
		expect(entry.tokens).toContain('pdt');
	});

	test('extracts Eastern Time abbreviations for America/New_York', () => {
		const entry = buildTimezoneEntry('America/New_York');
		expect(entry.city).toBe('New York');
		expect(entry.tokens).toContain('new york');
		expect(entry.tokens).toContain('est');
		expect(entry.tokens).toContain('edt');
	});

	test('extracts European timezone aliases for Europe/Paris and Europe/London', () => {
		const paris = buildTimezoneEntry('Europe/Paris');
		expect(paris.city).toBe('Paris');
		expect(paris.tokens).toContain('cet');
		expect(paris.tokens).toContain('cest');

		const london = buildTimezoneEntry('Europe/London');
		expect(london.city).toBe('London');
		expect(london.tokens).toContain('bst');
	});

	test('handles UTC gracefully', () => {
		const utc = buildTimezoneEntry('UTC');
		expect(utc.city).toBe('UTC');
		expect(utc.tokens).toContain('utc');
	});
});

describe('searchTimezones', () => {
	const sampleTimezones = [
		'America/Los_Angeles',
		'America/New_York',
		'America/Chicago',
		'America/Denver',
		'Europe/London',
		'Europe/Paris',
		'Asia/Tokyo',
		'Asia/Kolkata',
		'Australia/Sydney',
		'UTC'
	];

	const index = getTimezoneIndex(sampleTimezones);

	test('returns all entries on empty or whitespace query', () => {
		expect(searchTimezones('', index)).toHaveLength(sampleTimezones.length);
		expect(searchTimezones('   ', index)).toHaveLength(sampleTimezones.length);
	});

	test('matches by city name', () => {
		const results = searchTimezones('Tokyo', index);
		expect(results.map((r) => r.tz)).toEqual(['Asia/Tokyo']);
	});

	test('matches by IANA identifier', () => {
		const results = searchTimezones('America/Chicago', index);
		expect(results.map((r) => r.tz)).toEqual(['America/Chicago']);
	});

	test('matches by timezone abbreviation (PST, EST, CET, BST, JST, IST)', () => {
		const pst = searchTimezones('pst', index);
		expect(pst.map((r) => r.tz)).toContain('America/Los_Angeles');

		const est = searchTimezones('est', index);
		expect(est.map((r) => r.tz)).toContain('America/New_York');

		const cet = searchTimezones('cet', index);
		expect(cet.map((r) => r.tz)).toContain('Europe/Paris');

		const bst = searchTimezones('bst', index);
		expect(bst.map((r) => r.tz)).toContain('Europe/London');

		const jst = searchTimezones('jst', index);
		expect(jst.map((r) => r.tz)).toEqual(['Asia/Tokyo']);

		const ist = searchTimezones('ist', index);
		expect(ist.map((r) => r.tz)).toEqual(['Asia/Kolkata']);
	});

	test('matches by generic timezone name', () => {
		const pacific = searchTimezones('Pacific', index);
		expect(pacific.map((r) => r.tz)).toContain('America/Los_Angeles');

		const eastern = searchTimezones('Eastern', index);
		expect(eastern.map((r) => r.tz)).toContain('America/New_York');
	});

	test('matches multi-word queries', () => {
		const results = searchTimezones('pacific los angeles', index);
		expect(results.map((r) => r.tz)).toEqual(['America/Los_Angeles']);
	});

	test('matches by offset (e.g. GMT or UTC)', () => {
		const results = searchTimezones('UTC', index);
		expect(results.map((r) => r.tz)).toContain('UTC');
	});

	test('returns empty array when no matches are found', () => {
		const results = searchTimezones('nonexistentplace123', index);
		expect(results).toHaveLength(0);
	});
});
