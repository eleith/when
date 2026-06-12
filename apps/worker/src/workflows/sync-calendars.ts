import { getOpenWorkflow, syncCalendars, type SyncCalendarsResult } from '@when/jobs';
import type { CalendarSyncScanner } from '../calendar/sync-scanner.js';

export function registerSyncCalendarsWorkflow(scanner: CalendarSyncScanner): void {
	getOpenWorkflow().implementWorkflow(syncCalendars, (): SyncCalendarsResult => {
		scanner.requestScan();
		return 'requested';
	});
}
