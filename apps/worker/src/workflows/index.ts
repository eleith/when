import { registerReconcileAppointmentWorkflow } from './reconcile-appointment.js';
import { registerDeliverAppointmentEmailWorkflow } from './deliver-appointment-email.js';
import { registerNotifyAppointmentWorkflow } from './notify-appointment.js';
import { registerPurgeAppointmentWorkflow } from './purge-appointment.js';
import { registerTestEmailWorkflow } from './test-email.js';
import { registerProbeProviderWorkflows } from './probe-provider.js';
import { registerProbeCalendarWorkflow } from './probe-calendar.js';
import { registerGenerateVideoChatWorkflow } from './generate-video-chat.js';
import { registerSyncCalendarsWorkflow } from './sync-calendars.js';
import { registerRefreshCalendarsWorkflow } from './refresh-calendars.js';
import { registerExpirePendingAppointmentsWorkflow } from './expire-pending-appointments.js';

/**
 * Register every workflow implementation on the openworkflow singleton. Called
 * once at boot, after `initOpenWorkflow`.
 */
export function registerWorkflows(): void {
	registerDeliverAppointmentEmailWorkflow();
	registerNotifyAppointmentWorkflow();
	registerReconcileAppointmentWorkflow();
	registerPurgeAppointmentWorkflow();
	registerTestEmailWorkflow();
	registerProbeProviderWorkflows();
	registerProbeCalendarWorkflow();
	registerGenerateVideoChatWorkflow();
	registerSyncCalendarsWorkflow();
	registerRefreshCalendarsWorkflow();
	registerExpirePendingAppointmentsWorkflow();
}
