import { Gauge, Registry } from '@prometheus-io/client';
import { register, operationFailuresTotal } from './registry';
import { decodeMetricsSnapshot } from './snapshot';
import { logger } from '../logger';

type WebSnapshot = Awaited<ReturnType<typeof register.getMetricsAsJSON>>;
type WorkerSnapshot = ReturnType<typeof decodeMetricsSnapshot>;

export async function collectMetricsResponse(
	fetch: typeof globalThis.fetch,
	workerUrl: string,
	token: string
): Promise<Response> {
	const { web, worker } = await collectMetrics(fetch, workerUrl, token);
	return metricsResponse(web, worker);
}

async function collectMetrics(fetch: typeof globalThis.fetch, workerUrl: string, token: string) {
	const [worker, web] = await Promise.all([
		collectWorkerMetrics(fetch, workerUrl, token),
		register.getMetricsAsJSON()
	]);
	// Worker failure can add a counter series after the concurrent web snapshot.
	const webMetrics = worker === null ? await register.getMetricsAsJSON() : web;
	return { web: webMetrics, worker };
}

async function collectWorkerMetrics(
	fetch: typeof globalThis.fetch,
	workerUrl: string,
	token: string
): Promise<WorkerSnapshot | null> {
	let body: string;
	try {
		const response = await fetch(`${workerUrl}/metrics`, {
			headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
			signal: AbortSignal.timeout(2000)
		});
		if (!response.ok) {
			const code =
				response.status === 401 || response.status === 403 ? 'unauthorized' : 'http_error';
			recordWorkerFailure(code, { status: response.status });
			return null;
		}
		body = await response.text();
	} catch (err) {
		recordWorkerFailure(
			err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'transport_error',
			{ err }
		);
		return null;
	}

	try {
		const snapshot: unknown = JSON.parse(body);
		const metrics = decodeMetricsSnapshot(snapshot);
		assertCompatibleMetricTypes(metrics);
		return metrics;
	} catch (err) {
		recordWorkerFailure('invalid_snapshot', { err });
		return null;
	}
}

function assertCompatibleMetricTypes(workerMetrics: WorkerSnapshot): void {
	const webTypes = new Map(
		register.getMetricsAsArray().map((metric) => [metric.name, metric.type])
	);
	for (const metric of workerMetrics) {
		const webType = webTypes.get(metric.name);
		if (webType !== undefined && webType !== metric.type) {
			throw new Error('Conflicting metric types');
		}
	}
}

async function metricsResponse(
	webMetrics: WebSnapshot,
	workerMetrics: WorkerSnapshot | null
): Promise<Response> {
	const scrapeRegistry = createScrapeRegistry(workerMetrics !== null);
	const scrapeMetrics = await scrapeRegistry.getMetricsAsJSON();
	const combined = Registry.aggregate([webMetrics, workerMetrics ?? [], scrapeMetrics]);
	const body = await combined.metrics();
	return new Response(body, { headers: { 'content-type': combined.contentType } });
}

function createScrapeRegistry(success: boolean): Registry {
	const registry = new Registry();
	registry.setDefaultLabels({ app: 'when' });
	new Gauge({
		name: 'when_worker_scrape_success',
		help: 'Whether this scrape collected usable worker metrics; not proof of queue progress.',
		registers: [registry]
	}).set(success ? 1 : 0);
	return registry;
}

function recordWorkerFailure(
	code: 'unauthorized' | 'http_error' | 'invalid_snapshot' | 'timeout' | 'transport_error',
	details: { status?: number; err?: unknown }
): void {
	operationFailuresTotal.inc({ operation: 'worker_scrape', code });
	logger.warn({ operation: 'worker_scrape', code, ...details }, 'Worker metrics unavailable');
}
