import { registerSendBookingEmailWorkflow } from './send-booking-email.js';
import { registerSendOwnerAlertWorkflow } from './send-owner-alert.js';

/**
 * Register every workflow implementation on the openworkflow singleton. Called
 * once at boot, after `initOpenWorkflow`.
 */
export function registerWorkflows(): void {
	registerSendBookingEmailWorkflow();
	registerSendOwnerAlertWorkflow();
}
