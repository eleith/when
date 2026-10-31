import { error } from '@sveltejs/kit';
import { collectMetricsResponse } from '#lib/server/metrics/scrape.js';
import { getConfig } from '#lib/server/state.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, fetch }) => {
	const config = getConfig();
	if (!config.prometheus.enabled) error(404);
	const token = config.prometheus.token;
	if (!token) return new Response('prometheus.token not configured', { status: 500 });
	if (request.headers.get('authorization') !== `Bearer ${token}`) {
		return new Response('Unauthorized', { status: 401 });
	}
	return collectMetricsResponse(fetch, config.url.worker, token);
};
