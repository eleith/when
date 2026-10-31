import { syncCalendars, type SyncCalendarsResult } from '@when/jobs';
import { scanOnce } from '../services/calendar-scan.js';
import { getWorkerContext } from '../services/context.js';
import { implementWorkflow } from '../services/workflow-registration.js';

interface SyncStep {
	run<T>(config: { name: string }, fn: () => Promise<T>): Promise<T>;
}

export async function runSyncCalendars(step: SyncStep): Promise<SyncCalendarsResult> {
	await step.run({ name: 'scan-calendars' }, async () => {
		const ctx = getWorkerContext();
		await scanOnce(ctx);
	});
	return 'requested';
}

export function registerSyncCalendarsWorkflow(): void {
	implementWorkflow(syncCalendars, ({ step }) => runSyncCalendars(step));
}
