import { register } from './registry.js';

export async function exportMetrics(json: boolean): Promise<{ contentType: string; body: string }> {
	if (json) {
		return {
			contentType: 'application/json; charset=utf-8',
			body: JSON.stringify(await register.getMetricsAsJSON())
		};
	}
	return { contentType: register.contentType, body: await register.metrics() };
}
