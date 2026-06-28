import { error } from '@sveltejs/kit';
import { register } from '$lib/server/metrics';
import { getConfig } from '$lib/server/state';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, fetch }) => {
	const config = getConfig();

	if (!config.prometheus.enabled) {
		error(404);
	}

	const token = config.prometheus.secret;
	if (!token) {
		return new Response('Prometheus secret not configured', { status: 500 });
	}

	const auth = request.headers.get('authorization');
	const expected = `Bearer ${token}`;
	if (!auth || auth !== expected) {
		return new Response('Unauthorized', { status: 401 });
	}

	const webMetrics = await register.metrics();
	let workerMetrics = '';

	try {
		const res = await fetch(`${config.url.worker}/metrics`, {
			headers: {
				authorization: `Bearer ${token}`
			},
			signal: AbortSignal.timeout(2000)
		});

		if (res.ok) {
			const text = await res.text();
			// Strip duplicate Prometheus headers (# HELP / # TYPE comments) from the worker payload
			workerMetrics = text.replace(/^#[^\r\n]*[\r\n]*/gm, '');
		} else {
			logger.warn({ status: res.status }, 'Failed to fetch worker metrics');
		}
	} catch (err) {
		logger.warn({ err }, 'Error fetching worker metrics');
	}

	// Combine web and worker metrics gracefully
	const body = [webMetrics, workerMetrics].filter(Boolean).join('\n');

	return new Response(body, {
		status: 200,
		headers: { 'content-type': register.contentType }
	});
};
