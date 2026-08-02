import { expect, test } from 'vitest';
import type { Meeting } from '@when/config';
import { resolveDuration } from './duration';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

const base: Meeting = {
	...validConfig.meetings[0],
	name: 'Chat',
	slug: 'chat',
	booking_calendar: 'cal'
};

function fd(entries: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(entries)) f.set(k, v);
	return f;
}

test('single-length meeting: defaults to the only length when none submitted', () => {
	expect(resolveDuration(base, fd({}))).toBe(30);
});

test('array meeting: defaults to the first length when none submitted', () => {
	expect(resolveDuration({ ...base, duration_minutes: [45, 15, 60] }, fd({}))).toBe(45);
});

test('array meeting: accepts a submitted length that is offered', () => {
	expect(resolveDuration({ ...base, duration_minutes: [15, 30, 60] }, fd({ duration: '60' }))).toBe(
		60
	);
});

test('returns null when a submitted length is not offered', () => {
	expect(
		resolveDuration({ ...base, duration_minutes: [15, 30] }, fd({ duration: '45' }))
	).toBeNull();
	expect(resolveDuration(base, fd({ duration: '999' }))).toBeNull();
});
