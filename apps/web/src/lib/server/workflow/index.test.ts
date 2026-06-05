import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { SendBookingEmailInput } from '@when/jobs';

const runWorkflow = vi.fn();

vi.mock('@when/jobs', () => ({
	getOpenWorkflow: () => ({ runWorkflow }),
	sendBookingEmail: { spec: { name: 'send-booking-email' } }
}));

import { enqueueBookingEmail } from './index';
import { sendBookingEmail } from '@when/jobs';

const input = {
	kind: 'confirmed',
	appointment: { id: 'appt-1' },
	eventType: undefined,
	links: { booked: '', cancel: '', reschedule: '', manage: '' }
} as unknown as SendBookingEmailInput;

describe('enqueueBookingEmail', () => {
	beforeEach(() => runWorkflow.mockReset());

	test('runs the workflow keyed by appointment id and kind', async () => {
		await enqueueBookingEmail(input);
		expect(runWorkflow).toHaveBeenCalledWith(sendBookingEmail, input, {
			idempotencyKey: 'appt-1:confirmed'
		});
	});
});
