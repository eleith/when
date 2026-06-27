import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { WhenConfiguration } from '@when/config';
import { register } from './metrics.js';

/** A tiny HTTP server exposing GET /health for container liveness checks and GET /metrics for scraping. */
export function createHealthServer(config: WhenConfiguration): Server {
	return createServer(async (req: IncomingMessage, res: ServerResponse) => {
		if (req.method === 'GET' && req.url === '/health') {
			res.statusCode = 200;
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify({ status: 'ok' }));
			return;
		}

		if (req.method === 'GET' && req.url === '/metrics') {
			if (!config.prometheus.enabled) {
				res.statusCode = 404;
				res.end();
				return;
			}

			const token = config.prometheus.secret;
			if (!token) {
				res.statusCode = 500;
				res.end('METRICS_TOKEN not configured');
				return;
			}

			const auth = req.headers['authorization'];
			const expected = `Bearer ${token}`;
			if (!auth || auth !== expected) {
				res.statusCode = 401;
				res.end('Unauthorized');
				return;
			}

			try {
				const body = await register.metrics();
				res.statusCode = 200;
				res.setHeader('content-type', register.contentType);
				res.end(body);
			} catch (err) {
				res.statusCode = 500;
				res.end(err instanceof Error ? err.message : String(err));
			}
			return;
		}

		res.statusCode = 404;
		res.end();
	});
}
