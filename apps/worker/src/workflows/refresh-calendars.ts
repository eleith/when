import { refreshCalendars, type RefreshCalendarsResult } from '@when/jobs';
import { refreshCycle } from '../calendar/refresh.js';
import type { RefreshOptions } from '../calendar/refresh-calendar.js';
import { getWorkerContext } from '../services/context.js';
import { implementWorkflow } from '../services/workflow-registration.js';

interface RefreshStep {
	run<T>(config: { name: string }, fn: () => Promise<T>): Promise<T>;
}

export async function runRefreshCalendars(
	step: RefreshStep,
	opts: RefreshOptions = {}
): Promise<RefreshCalendarsResult> {
	await step.run({ name: 'refresh-calendars' }, async () => {
		await refreshCycle(getWorkerContext(), opts);
	});
	return 'refreshed';
}

export function registerRefreshCalendarsWorkflow(): void {
	implementWorkflow(refreshCalendars, ({ step }) => runRefreshCalendars(step));
}
