import { expect, test } from 'vitest';
import { ownerAlert } from './owner-alert.js';
import { sampleConfig } from '../__fixtures__/booking.js';

test('broke alert addresses the owner and explains the consequence', async () => {
	const env = await ownerAlert(sampleConfig, {
		calendarId: 'work',
		kind: 'broke',
		since: '2026-05-01T10:00:00Z',
		reason: 'No successful refresh in over an hour.'
	});
	expect(env.to).toBe('owner@acme.test');
	expect(env.subject).toBe('Calendar sync problem: work');
	expect(env.text).toContain('stopped syncing');
	expect(env.text).toContain("won't reflect");
});

test('recovered alert is the all-clear', async () => {
	const env = await ownerAlert(sampleConfig, {
		calendarId: 'work',
		kind: 'recovered',
		since: null,
		reason: 'A refresh just succeeded.'
	});
	expect(env.to).toBe('owner@acme.test');
	expect(env.subject).toBe('Calendar sync recovered: work');
	expect(env.text).toContain('syncing again');
});
