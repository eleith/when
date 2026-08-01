import { connectProvider, getProviderAdapter, type ProviderAdapter } from '@when/calendar';
import { getProviderRefreshToken, recordServiceOutcome } from '@when/db';
import { listProviderCalendars, testProvider } from '@when/jobs';
import type {
	ListProviderCalendarsInput,
	ListProviderCalendarsResult,
	TestProviderInput,
	TestProviderResult
} from '@when/jobs';
import { getWorkerContext, type WorkerContext } from '../services/context.js';
import { implementObservedWorkflow } from '../services/metrics.js';

async function connectedAdapter(ctx: WorkerContext, name: string): Promise<ProviderAdapter> {
	const provider = ctx.config.providers?.find((p) => p.name === name);
	if (!provider) throw new Error(`No provider named "${name}".`);

	const refreshToken = await getProviderRefreshToken(ctx.db, name);
	return getProviderAdapter(connectProvider(provider, refreshToken));
}

async function observed<T>(ctx: WorkerContext, name: string, work: () => Promise<T>): Promise<T> {
	const at = Temporal.Now.instant().toString();
	try {
		const result = await work();
		await recordServiceOutcome(ctx.db, { kind: 'provider', name }, { at, via: 'test' });
		return result;
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		if (ctx.config.providers?.some((p) => p.name === name)) {
			await recordServiceOutcome(ctx.db, { kind: 'provider', name }, { at, via: 'test', error });
		}
		throw err;
	}
}

export async function runTestProvider(input: TestProviderInput): Promise<TestProviderResult> {
	const ctx = getWorkerContext();
	await observed(ctx, input.name, async () => {
		const adapter = await connectedAdapter(ctx, input.name);
		await adapter.verify();
	});
	return 'authenticated';
}

export async function runListProviderCalendars(
	input: ListProviderCalendarsInput
): Promise<ListProviderCalendarsResult> {
	const ctx = getWorkerContext();
	return observed(ctx, input.name, async () => {
		const adapter = await connectedAdapter(ctx, input.name);
		return { field: adapter.calendarIdField, calendars: await adapter.listCalendars() };
	});
}

export function registerProbeProviderWorkflows(): void {
	implementObservedWorkflow(testProvider, ({ input }) => runTestProvider(input));
	implementObservedWorkflow(listProviderCalendars, ({ input }) => runListProviderCalendars(input));
}
