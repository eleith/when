import { expect, test } from 'vitest';
import { render } from 'svelte/server';
import type { ActionLogEntry } from '@when/db';
import AppointmentLog from './AppointmentLog.svelte';

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

test.each([
	{ action: 'email', metadata: undefined, expected: 'Email queued' },
	{ action: 'email', metadata: { state: 'done' }, expected: 'Email sent' },
	{ action: 'email', metadata: { state: 'failed' }, expected: 'Email failed' },
	{ action: 'calendar', metadata: undefined, expected: 'Calendar sync queued' },
	{ action: 'calendar', metadata: { state: 'done' }, expected: 'Calendar synced' },
	{ action: 'calendar', metadata: { state: 'failed' }, expected: 'Calendar sync failed' },
	{ action: 'video_chat', metadata: undefined, expected: 'Video room queued' },
	{ action: 'video_chat', metadata: { state: 'done' }, expected: 'Video room created' },
	{ action: 'video_chat', metadata: { state: 'failed' }, expected: 'Video room failed' }
] as const)('$action status is shown as "$expected"', ({ action, metadata, expected }) => {
	expect(renderEntry(action, metadata)).toContain(expected);
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
