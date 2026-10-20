import { syncCalendars, type SyncCalendarsResult } from '@when/jobs';
import { scanOnce } from '../calendar/sync.js';
import { getWorkerContext } from '../services/context.js';
import { calendarSyncTotal, implementObservedWorkflow } from '../services/metrics.js';

interface SyncStep {
	run<T>(config: { name: string }, fn: () => Promise<T>): Promise<T>;
}

export async function runSyncCalendars(step: SyncStep): Promise<SyncCalendarsResult> {
	await step.run({ name: 'scan-calendars' }, async () => {
		const ctx = getWorkerContext();
		try {
			await scanOnce(ctx);
			calendarSyncTotal.inc({ status: 'success' });
		} catch (error) {
			calendarSyncTotal.inc({ status: 'failure' });
			throw error;
		}
	});
	return 'requested';
}

export function registerSyncCalendarsWorkflow(): void {
	implementObservedWorkflow(syncCalendars, ({ step }) => runSyncCalendars(step));
}
