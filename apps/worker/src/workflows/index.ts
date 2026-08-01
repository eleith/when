import { registerReconcileAppointmentWorkflow } from './reconcile-appointment.js';
import { registerPurgeAppointmentWorkflow } from './purge-appointment.js';
import { registerTestEmailWorkflow } from './test-email.js';
import { registerProbeProviderWorkflows } from './probe-provider.js';
import { registerProbeCalendarWorkflow } from './probe-calendar.js';

/**
 * Register every workflow implementation on the openworkflow singleton. Called
 * once at boot, after `initOpenWorkflow`.
 */
export function registerWorkflows(): void {
	registerReconcileAppointmentWorkflow();
	registerPurgeAppointmentWorkflow();
	registerTestEmailWorkflow();
	registerProbeProviderWorkflows();
	registerProbeCalendarWorkflow();
}
