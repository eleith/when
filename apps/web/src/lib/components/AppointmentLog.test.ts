import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import type { ActionLogEntry } from '@when/db';

const source = readFileSync(
	fileURLToPath(new URL('./AppointmentLog.svelte', import.meta.url)),
	'utf8'
);

// Typed as a full Record, so a new action fails to compile until it is listed here — which
// is what drags the missing copy branch into view. Without one the log renders `video_chat`.
const ACTIONS: Record<ActionLogEntry['action'], true> = {
	create: true,
	confirm: true,
	decline: true,
	cancel: true,
	reschedule: true,
	rotate: true,
	expire: true,
	email: true,
	calendar: true,
	video_chat: true,
	edit: true
};

test.for(Object.keys(ACTIONS))('the log has copy for a %s entry', (action) => {
	expect(source).toContain(`entry.action === '${action}'`);
});
