import { define } from 'gunshi';
import { getCalendarAdapter, type ExpandWindow } from '@when/calendar';
import { interpolate, MissingEnvVarsError, type WhenConfiguration } from '@when/config';
import { loadConfigFromCtx } from '../../utils/command.ts';
import { pass, fail } from '../../utils/report.ts';

const WINDOW_DAYS = 14;

export const testCommand = define({
	name: 'test',
	description: 'fetch busy intervals to confirm a calendar is reachable',
	args: {
		name: { type: 'positional', required: false, description: 'the calendar to test' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	async run(ctx) {
		const name = ctx.values?.name as string | undefined;
		if (!name) {
			fail('calendar test requires a calendar name');
			return;
		}
		const config = await loadConfigFromCtx(ctx.values?.config);
		if (!config) return;
		await runCalendarTest(config, name);
	}
});

export async function runCalendarTest(config: WhenConfiguration, name: string): Promise<void> {
	const cal = config.calendars.find((c) => c.name === name);
	if (!cal) {
		fail(`no calendar named "${name}"`);
		return;
	}

	const resolved = resolveForAdapter(config, cal, name);
	if (!resolved) return;

	try {
		const now = Temporal.Now.instant();
		const window: ExpandWindow = { start: now, end: now.add({ hours: 24 * WINDOW_DAYS }) };
		const busy = await getCalendarAdapter(resolved.cal, resolved.services).fetchBusy(window);
		pass(
			`${name} (${cal.type}) — ${busy.length} busy interval(s) over the next ${WINDOW_DAYS} days`
		);
	} catch (err) {
		fail(`${name} (${cal.type}) — ${err instanceof Error ? err.message : String(err)}`);
	}
}

function resolveForAdapter(
	config: WhenConfiguration,
	cal: WhenConfiguration['calendars'][number],
	name: string
) {
	const service = config.services?.find((s) => s.name === cal.service);
	try {
		return {
			cal: interpolate(cal),
			services: service ? [interpolate(service)] : []
		};
	} catch (err) {
		if (err instanceof MissingEnvVarsError) {
			fail(`${name} — unset env var(s): ${err.missing.join(', ')}`);
			return null;
		}
		throw err;
	}
}
