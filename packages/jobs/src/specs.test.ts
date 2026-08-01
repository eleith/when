import { expect, test } from 'vitest';
import {
	reconcileAppointment,
	syncCalendars,
	testEmail,
	testProvider,
	listProviderCalendars,
	testCalendar
} from './specs.js';

test('reconcileAppointment carries the shared workflow name', () => {
	// The name is the contract between producer (web) and worker — both resolve
	// the workflow by it, so it must stay stable.
	expect(reconcileAppointment.name).toBe('reconcile-appointment');
});

test('syncCalendars carries the shared workflow name', () => {
	expect(syncCalendars.name).toBe('sync-calendars');
});

test('testEmail carries the shared workflow name', () => {
	expect(testEmail.name).toBe('test-email');
});

test('the probes carry their shared workflow names', () => {
	expect(testProvider.name).toBe('test-provider');
	expect(listProviderCalendars.name).toBe('list-provider-calendars');
	expect(testCalendar.name).toBe('test-calendar');
});

test('a human is waiting on a probe, so it is not retried', () => {
	expect(testProvider.retryPolicy?.maximumAttempts).toBe(1);
	expect(listProviderCalendars.retryPolicy?.maximumAttempts).toBe(1);
	expect(testCalendar.retryPolicy?.maximumAttempts).toBe(1);
});
