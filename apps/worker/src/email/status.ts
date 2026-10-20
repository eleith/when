import { recordServiceOutcome } from '@when/db';
import type { WorkerContext } from '../services/context.js';
import type { SendResult } from './smtp.js';
import { systemClock, type Clock } from './clock.js';

export async function recordSendOutcome(
	ctx: WorkerContext,
	result: SendResult,
	clock: Pick<Clock, 'now'> = systemClock
): Promise<void> {
	await recordServiceOutcome(
		ctx.db,
		{ kind: 'smtp' },
		{
			at: clock.now().toISOString(),
			via: 'send',
			error: result.ok ? null : result.reason
		}
	);
}
