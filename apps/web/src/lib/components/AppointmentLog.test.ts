import { expect, test } from 'vitest';
import { render } from 'svelte/server';
import type { ActionLogEntry } from '@when/db';
import AppointmentLog from './AppointmentLog.svelte';

// A new action must have an expected human-readable label, not just an icon branch.
const ACTION_COPY: Record<ActionLogEntry['action'], string> = {
	create: 'Created',
	confirm: 'Confirmed',
	decline: 'Declined',
	cancel: 'Cancelled',
	reschedule: 'Rescheduled',
	rotate: 'Guest link rotated',
	expire: 'Expired',
	email: 'Email queued',
	calendar: 'Calendar sync queued',
	video_chat: 'Video room queued',
	edit: 'Details updated'
};

function renderEntry(action: ActionLogEntry['action'], metadata?: Record<string, unknown>) {
	const entry: ActionLogEntry = {
		action,
		actor: 'system',
		at: '2026-04-15T14:00:00Z',
		payload: { metadata }
	};
	const rendered = render(AppointmentLog, { props: { log: [entry], displayTz: 'UTC' } });
	return rendered.body
		.replace(/<[^>]*>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

test.for(Object.keys(ACTION_COPY) as ActionLogEntry['action'][])(
	'renders human-readable copy for %s',
	(action) => {
		expect(renderEntry(action)).toContain(ACTION_COPY[action]);
	}
);

test.each([
	['email', 'done', 'Email sent'],
	['email', 'failed', 'Email failed'],
	['calendar', 'done', 'Calendar synced'],
	['calendar', 'failed', 'Calendar sync failed'],
	['video_chat', 'done', 'Video room created'],
	['video_chat', 'failed', 'Video room failed']
] as const)('renders %s in the %s state', (action, state, copy) => {
	expect(renderEntry(action, { state })).toContain(copy);
});

test('describes a duration change with its previous and new lengths', () => {
	const text = renderEntry('edit', {
		changes: ['duration_updated'],
		previous_duration: 30,
		duration: 45
	});
	expect(text).toContain('Duration changed from 30 to 45 minutes');
});

test('describes a duration change without inventing missing lengths', () => {
	const text = renderEntry('edit', { changes: ['duration_updated'] });
	expect(text).toContain('Duration changed');
	expect(text).not.toContain('Duration changed from');
	expect(text).not.toContain('Details updated');
});
