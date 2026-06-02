import { expect, test } from 'vitest';
import type { Appointment } from '@when/db';
import { createClient } from './queue.js';
import { sendBookingEmail } from './specs.js';
import type { SendBookingEmailInput } from './specs.js';

const appointment: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min',
	start_time: '2026-01-01T10:00:00Z',
	end_time: '2026-01-01T10:30:00Z',
	attendee_name: 'Jane',
	attendee_email: 'jane@example.com',
	attendee_notes: null,
	location: null,
	status: 'confirmed',
	cancel_token: 'tok-1',
	external_event_id: null,
	external_calendar_id: null,
	notification_status: null,
	ics_sequence: 0,
	created_at: '2026-01-01T09:00:00Z',
	updated_at: '2026-01-01T09:00:00Z'
};

test('createClient builds a node:sqlite client that can enqueue a run', async () => {
	// :memory: backend auto-migrates on connect, so runWorkflow can insert a
	// pending run without a worker present (producer-only path).
	const client = createClient(':memory:');
	const input: SendBookingEmailInput = {
		kind: 'confirmed',
		appointment,
		eventType: undefined,
		links: {
			booked: 'https://when.example.com/booked/appt-1',
			cancel: 'https://when.example.com/booked/appt-1?cancel=1',
			reschedule: 'https://when.example.com/schedule/30-min',
			manage: 'https://when.example.com/signin'
		}
	};

	const handle = await client.runWorkflow(sendBookingEmail, input);

	expect(handle.workflowRun.id).toBeTruthy();
	expect(handle.workflowRun.status).toBe('pending');
});
