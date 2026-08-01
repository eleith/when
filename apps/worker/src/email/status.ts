import { recordServiceOutcome } from '@when/db';
import type { WorkerContext } from '../services/context.js';
import type { SendResult } from './smtp.js';

export async function recordSendOutcome(ctx: WorkerContext, result: SendResult): Promise<void> {
	await recordServiceOutcome(
		ctx.db,
		{ kind: 'smtp' },
		{
			at: Temporal.Now.instant().toString(),
			via: 'send',
			error: result.ok ? null : result.reason
		}
	);
}
