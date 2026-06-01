import type { OpenWorkflow } from 'openworkflow';
import { createClient } from '@when/jobs';

/**
 * Connect the worker's openworkflow client over the queue database. The worker
 * owns the queue schema, so it connects with migrations enabled (the default).
 */
export function createQueueClient(queueDbPath: string): OpenWorkflow {
	return createClient(queueDbPath);
}
