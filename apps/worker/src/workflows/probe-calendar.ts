import { testCalendar } from '@when/jobs';
import type { TestCalendarInput, TestCalendarResult } from '@when/jobs';
import { refreshCalendar, refreshWindow } from '../calendar/refresh.js';
import { getWorkerContext } from '../services/context.js';
import { implementObservedWorkflow } from '../services/metrics.js';

export async function runTestCalendar(input: TestCalendarInput): Promise<TestCalendarResult> {
	const ctx = getWorkerContext();
	const cal = ctx.config.calendars.find((c) => c.name === input.name);
	if (!cal) throw new Error(`No calendar named "${input.name}".`);

	const now = Temporal.Now.instant();
	const window = refreshWindow(ctx.config, cal.name, now);
	const result = await refreshCalendar(ctx, cal, window, { now, via: 'test' });
	if (!result.ok) throw new Error(result.error);

	const days = Math.round(window.start.until(window.end).total({ unit: 'hours' }) / 24);
	return { busyCount: result.busyCount, days };
}

export function registerProbeCalendarWorkflow(): void {
	implementObservedWorkflow(testCalendar, ({ input }) => runTestCalendar(input));
}
