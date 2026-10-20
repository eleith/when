import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { initOpenWorkflow, closeOpenWorkflow } from './openworkflow.js';
import {
	reconcileAppointment,
	syncCalendars,
	refreshCalendars,
	expirePendingAppointments,
	testEmail,
	testProvider,
	listProviderCalendars,
	testCalendar,
	generateVideoChat
} from './specs.js';

test('reconcileAppointment carries the shared workflow name', () => {
	// The name is the contract between producer (web) and worker — both resolve
	// the workflow by it, so it must stay stable.
	expect(reconcileAppointment.name).toBe('reconcile-appointment');
});

test.each([
	[refreshCalendars, 'refresh-calendars', 'when:refresh-calendars', '*/5 * * * *'],
	[
		expirePendingAppointments,
		'expire-pending-appointments',
		'when:expire-pending-appointments',
		'0 * * * *'
	],
	[syncCalendars, 'sync-calendars', 'when:sync-calendars', '*/10 * * * *']
])('%s declares its stable payload-free UTC schedule', (spec, name, id, cron) => {
	expect(spec.name).toBe(name);
	expect(spec.version).toBeUndefined();
	expect(spec.schedules).toEqual([{ id, cron, timezone: 'UTC', input: {} }]);
});

test('producer initialization and maintenance enqueues do not persist schedules', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'when-producer-schedules-'));
	try {
		const client = initOpenWorkflow({ dbPath: join(directory, 'queue.sqlite') });
		const schedulesBeforeEnqueue = await client.schedules.list();
		expect(schedulesBeforeEnqueue.data).toEqual([]);
		for (const spec of [refreshCalendars, expirePendingAppointments, syncCalendars]) {
			const handle = await client.runWorkflow(spec, {});
			expect(handle.workflowRun).toMatchObject({
				workflowName: spec.name,
				status: 'pending',
				input: {},
				workflowScheduleId: null
			});
		}
		const schedulesAfterEnqueue = await client.schedules.list();
		expect(schedulesAfterEnqueue.data).toEqual([]);
	} finally {
		await closeOpenWorkflow();
		await rm(directory, { recursive: true, force: true });
	}
});

test('sync retains its workflow-level backstop', () => {
	expect(syncCalendars.retryPolicy).toEqual({
		maximumAttempts: 1,
		initialInterval: '1s',
		backoffCoefficient: 2,
		maximumInterval: '1s'
	});
});

test('testEmail carries the shared workflow name', () => {
	expect(testEmail.name).toBe('test-email');
});

test('the probes carry their shared workflow names', () => {
	expect(testProvider.name).toBe('test-provider');
	expect(listProviderCalendars.name).toBe('list-provider-calendars');
	expect(testCalendar.name).toBe('test-calendar');
});

test('a human is waiting on a probe or on-demand action, so it is not retried', () => {
	expect(testProvider.retryPolicy?.maximumAttempts).toBe(1);
	expect(listProviderCalendars.retryPolicy?.maximumAttempts).toBe(1);
	expect(testCalendar.retryPolicy?.maximumAttempts).toBe(1);
	expect(generateVideoChat.retryPolicy?.maximumAttempts).toBe(1);
});

test('generateVideoChat carries the shared workflow name', () => {
	expect(generateVideoChat.name).toBe('generate-video-chat');
});
