import { define } from 'gunshi';
import { listProviderCalendars } from '@when/jobs';
import { providersAndName, requireProvider } from './shared.ts';
import { runInWorker } from '../../utils/worker.ts';
import { pass, fail } from '../../utils/report.ts';

export const calendarsCommand = define({
	name: 'calendars',
	description: 'list the calendars a provider exposes',
	args: {
		name: { type: 'positional', required: false, description: 'the provider to inspect' },
		config: { type: 'string', short: 'c', description: 'Path to when.yaml file' }
	},
	toKebab: true,
	async run(ctx) {
		const resolved = await providersAndName(ctx.values?.name, ctx.values?.config, 'calendars');
		if (!resolved) return;

		const provider = requireProvider(resolved.config.providers ?? [], resolved.name);
		if (!provider) return;

		const label = `${provider.name} (${provider.type})`;
		const run = await runInWorker(resolved.config, listProviderCalendars, { name: provider.name });
		if (!run.ok) {
			fail(`${label} — ${run.message}`);
			return;
		}

		const { field, calendars } = run.value;
		if (calendars.length === 0) {
			pass(`${label} — no calendars found`);
			return;
		}
		pass(`${label} — ${calendars.length} calendar(s):`);
		for (const calendar of calendars) {
			console.log(`  ${field}: ${calendar.id}  ${calendar.name}`);
		}
	}
});
