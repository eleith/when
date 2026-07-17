import { registerReconcileAppointmentWorkflow } from './reconcile-appointment.js';
import { registerPurgeAppointmentWorkflow } from './purge-appointment.js';
import { registerTestEmailWorkflow } from './test-email.js';

/**
 * Register every workflow implementation on the openworkflow singleton. Called
 * once at boot, after `initOpenWorkflow`.
 */
export function registerWorkflows(): void {
	registerReconcileAppointmentWorkflow();
	registerPurgeAppointmentWorkflow();
	registerTestEmailWorkflow();
}
