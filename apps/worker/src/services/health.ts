import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';

/** A tiny HTTP server exposing GET /health for container liveness checks. */
export function createHealthServer(): Server {
	return createServer((req: IncomingMessage, res: ServerResponse) => {
		if (req.method === 'GET' && req.url === '/health') {
			res.statusCode = 200;
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify({ status: 'ok' }));
			return;
		}
		res.statusCode = 404;
		res.end();
	});
}
