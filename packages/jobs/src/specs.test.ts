import { expect, test } from 'vitest';
import { sendAppointmentEmail, syncCalendars } from './specs.js';

test('sendAppointmentEmail carries the shared workflow name', () => {
	// The name is the contract between producer (web) and worker — both resolve
	// the workflow by it, so it must stay stable.
	expect(sendAppointmentEmail.name).toBe('send-appointment-email');
});

test('syncCalendars carries the shared workflow name', () => {
	expect(syncCalendars.name).toBe('sync-calendars');
});
