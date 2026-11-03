import { afterEach, beforeAll, beforeEach, describe, test, expect, vi } from 'vitest';
import {
	buildTimezoneEntry,
	getTimezoneIndex,
	searchTimezones,
	type TimezoneIndex
} from '#lib/timezones.js';

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

	let index: TimezoneIndex;
	beforeAll(async () => {
		index = await getTimezoneIndex(sampleTimezones);
	});

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

describe('getTimezoneIndex', () => {
	let loadIndex: typeof getTimezoneIndex;

	beforeEach(async () => {
		vi.useFakeTimers();
		vi.resetModules();
		({ getTimezoneIndex: loadIndex } = await import('#lib/timezones.js'));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	test('yields before building entries and between batches, without changing the result', async () => {
		const zones = Intl.supportedValuesOf('timeZone').slice(0, 20);
		const now = new Date();
		const formatters = vi.spyOn(Intl, 'DateTimeFormat');
		const pending = loadIndex(zones, now);
		expect(formatters).not.toHaveBeenCalled();

		await vi.advanceTimersToNextTimerAsync();
		const firstBatchCalls = formatters.mock.calls.length;
		expect(firstBatchCalls).toBeGreaterThan(0);
		await vi.runAllTimersAsync();
		expect(formatters.mock.calls.length).toBeGreaterThan(firstBatchCalls);

		const index = await pending;
		expect(index.entries).toEqual(zones.map((tz) => buildTimezoneEntry(tz, now)));
		expect([...index.byTz.keys()]).toEqual(zones);
	});

	test('shares pending work and reuses the completed default index', async () => {
		const supported = vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Asia/Tokyo']);
		const formatters = vi.spyOn(Intl, 'DateTimeFormat');
		const first = loadIndex();
		const concurrent = loadIndex();
		expect(concurrent).toBe(first);
		await vi.runAllTimersAsync();
		const index = await first;
		const calls = formatters.mock.calls.length;

		expect(index.entries.map((entry) => entry.tz)).toEqual(['Asia/Tokyo']);
		await expect(loadIndex()).resolves.toBe(index);
		expect(formatters).toHaveBeenCalledTimes(calls);
		expect(supported).toHaveBeenCalledTimes(1);
	});

	test('keeps explicit subsets and empty lists out of the shared cache', async () => {
		vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Asia/Tokyo']);
		const subset = loadIndex(['UTC']);
		const empty = loadIndex([]);
		const full = loadIndex();
		await vi.runAllTimersAsync();

		expect((await subset).entries.map((entry) => entry.tz)).toEqual(['UTC']);
		expect((await empty).entries).toEqual([]);
		expect((await full).entries.map((entry) => entry.tz)).toEqual(['Asia/Tokyo']);
		await expect(loadIndex()).resolves.toBe(await full);
	});

	test('clears failed work so the next request can retry', async () => {
		const supported = vi.spyOn(Intl, 'supportedValuesOf');
		supported.mockImplementationOnce(() => {
			throw new Error('Timezone lookup failed');
		});
		await expect(loadIndex()).rejects.toThrow('Timezone lookup failed');

		supported.mockReturnValue(['Asia/Tokyo']);
		const retry = loadIndex();
		await vi.runAllTimersAsync();
		expect((await retry).byTz.has('Asia/Tokyo')).toBe(true);
		expect(supported).toHaveBeenCalledTimes(2);
	});
});
