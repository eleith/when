import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';

// Bind first so config, Better Auth, Kit's origin check and the browser all use the
// same OS-assigned port. Nothing can reach the app until the handler is installed.
const server = createServer();
// No background worker runs: jobs remain queued for assertions. Closing the web
// process also releases its config watcher and SQLite connections.
function shutdown() {
	server.close(() => process.exit(0));
	server.closeIdleConnections();
	setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('disconnect', shutdown);

server.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
	server.once('listening', resolve);
	server.once('error', reject);
});
// localhost also lets Playwright's API client send Better Auth's secure session cookie
// over HTTP, matching the browser's loopback secure-context exception.
const origin = `http://localhost:${server.address().port}`;
process.env.ORIGIN = origin;
process.env.PROTOCOL_HEADER = 'x-forwarded-proto';
const configPath = process.env.CONFIG_PATH;
const directory = dirname(dirname(configPath));
const config = parse(
	await readFile(new URL('./fixture/config/when.yaml', import.meta.url), 'utf8')
);
config.database = {
	app: join(directory, 'data/when.sqlite'),
	queue: join(directory, 'data/openworkflow.sqlite')
};
config.url = { ...config.url, app: origin, internal: origin };
await mkdir(dirname(configPath), { recursive: true });
await writeFile(configPath, stringify(config));
const handlerPath = join(process.env.WHEN_E2E_RUN_DIR, 'project/build/handler.js');
const { handler } = await import(pathToFileURL(handlerPath).href);
server.on('request', (req, res) => {
	// This loopback boundary supplies the trusted scheme; Host/port stay native.
	req.headers['x-forwarded-proto'] = 'http';
	handler(req, res);
});

process.send({ origin });
