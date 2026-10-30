import { describe, expect, test } from 'vitest';
import type { Meeting } from '@when/config';
import type { Appointment } from '@when/db';
import { resolveBookingDurations, resolveDuration } from './duration';
import { validConfig } from '#lib/server/__fixtures__/valid-config.js';

const base: Meeting = {
	...validConfig.meetings['30-min-chat'],
	title: 'Chat',
	booking_calendar: 'cal'
};
const hostPalette = [15, 30, 45, 60, 90, 120, 180, 240, 300];

function fd(entries: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(entries)) f.set(k, v);
	return f;
}

function currentDuration(minutes: number): Pick<Appointment, 'start_time' | 'end_time'> {
	const start = Temporal.Instant.from('2030-06-03T10:00:00Z');
	return { start_time: start.toString(), end_time: start.add({ minutes }).toString() };
}

describe('resolveBookingDurations', () => {
	test('hosts get the full palette union configured extras, deduplicated without mutating config', () => {
		const meeting = {
			...base,
			duration_minutes: 60,
			additional_duration_minutes: [75, 15, 17, 120]
		};
		const original = structuredClone(meeting);
		const profile = resolveBookingDurations(meeting, 'host');
		expect(profile).toEqual({
			defaultDuration: 60,
			durations: [15, 17, 30, 45, 60, 75, 90, 120, 180, 240, 300]
		});
		expect(meeting).toEqual(original);
		expect(profile.durations).not.toBe(meeting.additional_duration_minutes);
		expect(resolveBookingDurations(meeting, 'host')).toEqual(profile);
	});

	test('guest choices are numerically ordered without changing the configured default or adding host choices', () => {
		const meeting = { ...base, duration_minutes: 60, additional_duration_minutes: [15, 75, 30] };
		const original = structuredClone(meeting);
		expect(resolveBookingDurations(meeting, 'guest')).toEqual({
			defaultDuration: 60,
			durations: [15, 30, 60, 75]
		});
		expect(meeting).toEqual(original);
	});

	test('a new single-length meeting offers one guest length and the full host palette', () => {
		expect(resolveBookingDurations(base, 'guest')).toEqual({
			defaultDuration: 30,
			durations: [30]
		});
		expect(resolveBookingDurations(base, 'host')).toEqual({
			defaultDuration: 30,
			durations: hostPalette
		});
	});

	test.each(['guest', 'host'] as const)(
		'%s retains the actual current 90 or non-palette 85 as its default',
		(role) => {
			for (const minutes of [90, 85]) {
				const current = currentDuration(minutes);
				const original = structuredClone(current);
				const profile = resolveBookingDurations(base, role, current);
				expect(profile.defaultDuration).toBe(minutes);
				expect(profile.durations).toEqual(
					role === 'guest'
						? [30, minutes]
						: minutes === 90
							? hostPalette
							: [15, 30, 45, 60, 85, 90, 120, 180, 240, 300]
				);
				expect(current).toEqual(original);
			}
		}
	);

	test('rescheduling retains the booked default independently of the sorted choices', () => {
		const meeting = { ...base, duration_minutes: 60, additional_duration_minutes: [15, 30] };
		expect(resolveBookingDurations(meeting, 'guest', currentDuration(30))).toEqual({
			defaultDuration: 30,
			durations: [15, 30, 60]
		});
	});

	test.each([
		['spring forward', '2030-03-10T01:30:00-05:00', '2030-03-10T04:00:00-04:00', 90],
		['fall back', '2030-11-03T01:30:00-04:00', '2030-11-03T01:55:00-05:00', 85],
		['seconds across DST', '2030-03-10T01:45:30-05:00', '2030-03-10T04:10:30-04:00', 85],
		['equivalent offsets', '2030-06-03T12:00:00+02:00', '2030-06-03T11:25:00+00:00', 85]
	])('uses elapsed instants without rounding for %s', (_label, start_time, end_time, minutes) => {
		const current = { start_time: String(start_time), end_time: String(end_time) };
		for (const role of ['guest', 'host'] as const) {
			const profile = resolveBookingDurations(base, role, current);
			expect(profile.defaultDuration).toBe(minutes);
			expect(profile.durations).toContain(minutes);
			expect(resolveDuration(base, role, fd({}), current)).toBe(minutes);
			expect(resolveDuration(base, role, fd({ duration: String(minutes) }), current)).toBe(minutes);
		}
	});
});

describe('resolveDuration', () => {
	test.each(['guest', 'host'] as const)(
		'%s defaults missing and empty submissions to configured default, not the first host choice',
		(role) => {
			const meeting = { ...base, duration_minutes: 60, additional_duration_minutes: [15, 30] };
			expect(resolveDuration(base, role, fd({}))).toBe(30);
			expect(resolveDuration(meeting, role, fd({}))).toBe(60);
			expect(resolveDuration(meeting, role, fd({ duration: '' }))).toBe(60);
		}
	);

	test('guests can choose configured lengths but not new host-only lengths', () => {
		const meeting = { ...base, duration_minutes: 15, additional_duration_minutes: [30, 60] };
		expect(resolveDuration(meeting, 'guest', fd({ duration: '60' }))).toBe(60);
		expect(resolveDuration(meeting, 'guest', fd({ duration: '45' }))).toBeNull();
		expect(resolveDuration(meeting, 'guest', fd({ duration: '90' }))).toBeNull();
	});

	test('hosts can submit every palette length and configured extras, but not arbitrary lengths', () => {
		const meeting = { ...base, additional_duration_minutes: [75] };
		for (const minutes of [...hostPalette, 75]) {
			expect(resolveDuration(meeting, 'host', fd({ duration: String(minutes) }))).toBe(minutes);
		}
		for (const role of ['guest', 'host'] as const) {
			for (const duration of ['17', '999', '0', '-30', 'not-a-number']) {
				expect(resolveDuration(meeting, role, fd({ duration }))).toBeNull();
			}
		}
	});

	test.each(['guest', 'host'] as const)(
		'%s can keep 90 and 85 with missing, empty, or explicit duration',
		(role) => {
			for (const minutes of [90, 85]) {
				const current = currentDuration(minutes);
				expect(resolveDuration(base, role, fd({}), current)).toBe(minutes);
				expect(resolveDuration(base, role, fd({ duration: '' }), current)).toBe(minutes);
				expect(resolveDuration(base, role, fd({ duration: String(minutes) }), current)).toBe(
					minutes
				);
			}
		}
	);

	test('a guest retaining 90 can change to configured 30, not host-only 120; hosts may choose 120', () => {
		const current = currentDuration(90);
		expect(resolveDuration(base, 'guest', fd({ duration: '120' }), current)).toBeNull();
		expect(resolveDuration(base, 'guest', fd({ duration: '30' }), current)).toBe(30);
		expect(resolveDuration(base, 'host', fd({ duration: '120' }), current)).toBe(120);
	});

	test('forged role and current-duration fields cannot replace the trusted role or server row', () => {
		const current = currentDuration(85);
		const forged = {
			role: 'host',
			currentDuration: '120',
			start_time: '2030-06-03T10:00:00Z',
			end_time: '2030-06-03T12:00:00Z'
		};
		expect(resolveDuration(base, 'guest', fd(forged), current)).toBe(85);
		expect(resolveDuration(base, 'guest', fd({ ...forged, duration: '' }), current)).toBe(85);
		expect(resolveDuration(base, 'guest', fd({ ...forged, duration: '120' }), current)).toBeNull();
		expect(resolveDuration(base, 'guest', fd({ ...forged, duration: '85' }), current)).toBe(85);
		expect(resolveDuration(base, 'guest', fd(forged))).toBe(30);
		expect(resolveDuration(base, 'guest', fd({ ...forged, duration: '120' }))).toBeNull();
	});
});
