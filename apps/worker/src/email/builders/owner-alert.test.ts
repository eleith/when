import { expect, test } from 'vitest';
import { ownerAlert } from './owner-alert.js';
import { sampleConfig } from '../__fixtures__/booking.js';

test('broke alert addresses the owner and explains the consequence', () => {
	const msg = ownerAlert(
		sampleConfig,
		{
			calendarId: 'work',
			kind: 'broke',
			since: '2026-05-01T10:00:00Z',
			reason: 'No successful refresh in over an hour.'
		},
		null
	);
	expect(msg.to).toBe('owner@acme.test');
	expect(msg.content.subject).toBe('Calendar sync problem: work');
	expect(msg.content.heading).toContain('stopped syncing');
	expect(msg.content.paragraphs.join(' ')).toContain("won't reflect");
});

test('recovered alert is the all-clear', () => {
	const msg = ownerAlert(
		sampleConfig,
		{ calendarId: 'work', kind: 'recovered', since: null, reason: 'A refresh just succeeded.' },
		null
	);
	expect(msg.to).toBe('owner@acme.test');
	expect(msg.content.subject).toBe('Calendar sync recovered: work');
	expect(msg.content.heading).toContain('syncing again');
});
