import { recordServiceOutcome } from '@when/db';
import type { WorkerContext } from '../services/context.js';
import type { SendResult } from './smtp.js';

export async function recordSendOutcome(
	ctx: WorkerContext,
	result: SendResult,
	observedAt: string
): Promise<void> {
	await recordServiceOutcome(
		ctx.db,
		{ kind: 'smtp' },
		{
			at: observedAt,
			via: 'send',
			error: result.ok ? null : result.reason
		}
	);
}
