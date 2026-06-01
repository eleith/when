import { expect, test } from 'vitest';
import { sendBookingEmail } from './specs';

test('sendBookingEmail carries the shared workflow name', () => {
	// The name is the contract between producer (web) and worker — both resolve
	// the workflow by it, so it must stay stable.
	expect(sendBookingEmail.name).toBe('send-booking-email');
});
