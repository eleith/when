import { refreshCalendars, type RefreshCalendarsResult } from '@when/jobs';
import { refreshCycle, type RefreshOptions } from '../calendar/refresh.js';
import { getWorkerContext } from '../services/context.js';
import { implementObservedWorkflow } from '../services/metrics.js';

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
	implementObservedWorkflow(refreshCalendars, ({ step }) => runRefreshCalendars(step));
}
