import { expect, test } from 'vitest';
import { expandWeekly } from './expand-weekly';
import type { AvailabilityRule } from '@when/config';

test('spreads one rule across every day it names', () => {
	const rules: AvailabilityRule[] = [{ days: ['mon', 'wed', 'fri'], from: '09:00', to: '17:00' }];
	expect(expandWeekly(rules)).toEqual({
		mon: [{ from: '09:00', to: '17:00' }],
		wed: [{ from: '09:00', to: '17:00' }],
		fri: [{ from: '09:00', to: '17:00' }]
	});
});

test('keys the result by each day the rules name', () => {
	const rules: AvailabilityRule[] = [
		{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '08:00', to: '09:00' }
	];
	expect(Object.keys(expandWeekly(rules))).toEqual([
		'mon',
		'tue',
		'wed',
		'thu',
		'fri',
		'sat',
		'sun'
	]);
});

test('accumulates multiple windows for a repeated day, preserving order', () => {
	const rules: AvailabilityRule[] = [
		{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '08:00', to: '12:00' },
		{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '13:00', to: '17:00' }
	];
	expect(expandWeekly(rules).mon).toEqual([
		{ from: '08:00', to: '12:00' },
		{ from: '13:00', to: '17:00' }
	]);
});

test('leaves an unnamed day undefined (unavailable)', () => {
	const rules: AvailabilityRule[] = [{ days: ['mon'], from: '09:00', to: '17:00' }];
	const weekly = expandWeekly(rules);
	expect(weekly.sat).toBeUndefined();
	expect(weekly.sun).toBeUndefined();
});

test('drops an empty or backwards window (from >= to)', () => {
	const rules: AvailabilityRule[] = [
		{ days: ['mon'], from: '09:00', to: '09:00' },
		{ days: ['tue'], from: '17:00', to: '09:00' },
		{ days: ['wed'], from: '09:00', to: '17:00' }
	];
	expect(expandWeekly(rules)).toEqual({ wed: [{ from: '09:00', to: '17:00' }] });
});
