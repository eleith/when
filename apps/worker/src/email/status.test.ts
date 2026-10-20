import { expect, test } from 'vitest';
import { openDb, runMigrations, listServiceStatus } from '@when/db';
import type { WorkerContext } from '../services/context.js';
import { recordSendOutcome } from './status.js';

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

test('a failed send records the reason using the supplied clock', async () => {
	const ctx = await freshCtx();
	try {
		const at = '2026-02-01T12:00:00.000Z';
		await recordSendOutcome(ctx, { ok: false, reason: 'EAUTH' }, { now: () => new Date(at) });

		const [smtp] = await listServiceStatus(ctx.db, 'smtp');
		expect(smtp.error).toBe('EAUTH');
		expect(smtp.last_attempt_at).toBe(at);
		expect(smtp.failing_since).toBe(at);
		expect(smtp.last_ok_at).toBeNull();
	} finally {
		await ctx.db.destroy();
	}
});
