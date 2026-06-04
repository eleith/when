import { registerSendBookingEmailWorkflow } from './send-booking-email.js';

/**
 * Register every workflow implementation on the openworkflow singleton. Called
 * once at boot, after `initOpenWorkflow`.
 */
export function registerWorkflows(): void {
	registerSendBookingEmailWorkflow();
}
