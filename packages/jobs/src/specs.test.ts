import { expect, test } from 'vitest';
import { reconcileAppointment, syncCalendars, testEmail } from './specs.js';

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
