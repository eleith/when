const metricTypes = ['counter', 'gauge', 'histogram', 'summary'];
const aggregators = ['sum', 'first', 'min', 'max', 'average', 'omit'];

export function decodeMetricsSnapshot(value: unknown) {
	if (!Array.isArray(value)) throw new Error('Invalid metrics snapshot');
	return value.map(decodeMetric);
}

function decodeMetric(metric: unknown) {
	if (
		!isRecord(metric) ||
		!isMetricName(metric.name) ||
		typeof metric.help !== 'string' ||
		typeof metric.type !== 'string' ||
		!metricTypes.includes(metric.type) ||
		!isAggregator(metric.aggregator) ||
		!Array.isArray(metric.values)
	) {
		throw new Error('Invalid metrics snapshot');
	}
	return {
		...metric,
		name: metric.name,
		type: metric.type,
		values: metric.values.map(decodeSample)
	};
}

function decodeSample(sample: unknown) {
	if (
		!isRecord(sample) ||
		!isWorkerLabels(sample.labels) ||
		typeof sample.value !== 'number' ||
		!Number.isFinite(sample.value) ||
		(sample.metricName !== undefined && !isMetricName(sample.metricName))
	) {
		throw new Error('Invalid metrics sample');
	}
	return { ...sample, value: sample.value };
}

function isWorkerLabels(value: unknown): boolean {
	if (!isRecord(value) || value.app !== 'when' || value.service !== 'worker') return false;
	return Object.entries(value).every(
		([name, label]) =>
			/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name) &&
			(typeof label === 'string' || (typeof label === 'number' && Number.isFinite(label)))
	);
}

function isAggregator(value: unknown): boolean {
	return value === undefined || (typeof value === 'string' && aggregators.includes(value));
}

function isMetricName(value: unknown): value is string {
	return typeof value === 'string' && /^[:a-zA-Z_][:a-zA-Z_0-9]*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
