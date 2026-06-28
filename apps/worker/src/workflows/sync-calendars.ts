import { syncCalendars, type SyncCalendarsResult } from '@when/jobs';
import type { CalendarSyncScanner } from '../calendar/sync-scanner.js';
import { implementObservedWorkflow } from '../services/metrics.js';

export function registerSyncCalendarsWorkflow(scanner: CalendarSyncScanner): void {
	implementObservedWorkflow(syncCalendars, (): SyncCalendarsResult => {
		scanner.requestScan();
		return 'requested';
	});
}
