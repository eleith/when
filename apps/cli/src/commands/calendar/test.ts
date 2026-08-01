import { define } from 'gunshi';
import { getCalendarAdapter, type ExpandWindow, type ConnectedProvider } from '@when/calendar';
import type { WhenConfiguration } from '@when/config';
import { loadConfigFromCtx } from '../../utils/command.ts';
import { pass, fail } from '../../utils/report.ts';

const WINDOW_DAYS = 14;

export const testCommand = define({
	name: 'test',
	description: 'fetch busy intervals to confirm a calendar is reachable',
	args: {
		name: { type: 'positional', required: false, description: 'the calendar to test' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' },
		refreshToken: {
			type: 'string',
			description: 'refresh token for a google calendar (the stored one lives in the database)'
		}
	},
	toKebab: true,
	async run(ctx) {
		const name = ctx.values?.name as string | undefined;
		if (!name) {
			fail('calendar test requires a calendar name');
			return;
		}
		const config = await loadConfigFromCtx(ctx.values?.config);
		if (!config) return;
		await runCalendarTest(config, name, ctx.values?.refreshToken);
	}
});

export async function runCalendarTest(
	config: WhenConfiguration,
	name: string,
	refreshToken?: string
): Promise<void> {
	const cal = config.calendars.find((c) => c.name === name);
	if (!cal) {
		fail(`no calendar named "${name}"`);
		return;
	}

	const services = connectedServicesFor(config, cal, refreshToken);

	try {
		const now = Temporal.Now.instant();
		const window: ExpandWindow = { start: now, end: now.add({ hours: 24 * WINDOW_DAYS }) };
		const busy = await getCalendarAdapter(cal, services).fetchBusy(window);
		pass(
			`${name} (${cal.type}) — ${busy.length} busy interval(s) over the next ${WINDOW_DAYS} days`
		);
	} catch (err) {
		fail(`${name} (${cal.type}) — ${err instanceof Error ? err.message : String(err)}`);
	}
}

function connectedServicesFor(
	config: WhenConfiguration,
	cal: WhenConfiguration['calendars'][number],
	refreshToken?: string
): ConnectedProvider[] {
	const service = config.providers?.find((s) => s.name === cal.provider);
	if (!service) return [];
	return [
		service.type === 'google' ? { ...service, refresh_token: refreshToken ?? null } : service
	];
}
