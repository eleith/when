import { expect, test } from 'vitest';
import { openDb, runMigrations, listServiceStatus } from '@when/db';
import type { WorkerContext } from '../services/context.ts';
import { recordSendOutcome } from './status.ts';

async function freshCtx(): Promise<WorkerContext> {
	const db = openDb(':memory:');
	await runMigrations(db);
	return { db } as unknown as WorkerContext;
}

test('a sent email records smtp as working', async () => {
	const ctx = await freshCtx();
	try {
		await recordSendOutcome(ctx, { ok: true });

		const [smtp] = await listServiceStatus(ctx.db, 'smtp');
		expect(smtp.last_ok_at).toBeTruthy();
		expect(smtp.via).toBe('send');
		expect(smtp.error).toBeNull();
	} finally {
		await ctx.db.destroy();
	}
});

test('a failed send records the reason', async () => {
	const ctx = await freshCtx();
	try {
		await recordSendOutcome(ctx, { ok: false, reason: 'EAUTH' });

		const [smtp] = await listServiceStatus(ctx.db, 'smtp');
		expect(smtp.error).toBe('EAUTH');
		expect(smtp.failing_since).toBeTruthy();
		expect(smtp.last_ok_at).toBeNull();
	} finally {
		await ctx.db.destroy();
	}
});
