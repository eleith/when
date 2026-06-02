/**
 * Register every workflow implementation on the openworkflow singleton. Called
 * once at boot, after `initOpenWorkflow`. Empty until `send-booking-email` lands
 * (Phase 6); each workflow will add its `register…Workflow()` call here.
 */
export function registerWorkflows(): void {
	// no workflows registered yet
}
