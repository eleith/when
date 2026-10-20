import type { Server } from 'node:http';
import type { Worker } from 'openworkflow';

export interface ShutdownResources {
	worker?: Pick<Worker, 'stop'>;
	server?: Server;
	stopWatch?: () => void;
	closeQueue(): Promise<void>;
	closeDatabase(): Promise<void>;
}

export function createShutdown(resources: ShutdownResources): () => Promise<void> {
	let shutdownPromise: Promise<void> | undefined;
	return () => {
		shutdownPromise ??= stopResources(resources);
		return shutdownPromise;
	};
}

async function stopResources(resources: ShutdownResources): Promise<void> {
	resources.stopWatch?.();
	const serverClosed = new Promise<unknown>((resolve) => {
		try {
			if (resources.server?.listening) resources.server.close(resolve);
			else resolve(undefined);
		} catch (error) {
			resolve(error);
		}
	});
	await resources.worker?.stop();
	const serverError = await serverClosed;
	try {
		await resources.closeQueue();
	} finally {
		await resources.closeDatabase();
	}
	if (serverError) throw serverError;
}
