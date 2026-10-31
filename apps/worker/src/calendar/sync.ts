import { findAppointment, listOutOfSyncAppointments } from '@when/db';
import type { WorkerContext } from '../services/context.js';
import { reconcileAppointment } from '../services/calendar.js';
import { cleanupAppointmentVideoChat } from '../services/video-chat-cleanup.js';

export async function scanOnce(ctx: WorkerContext): Promise<void> {
	const rows = await listOutOfSyncAppointments(ctx.db);
	for (const row of rows) {
		const cleaned = await cleanupAppointmentVideoChat(ctx, row.id);
		if (!cleaned) continue;
		const current = await findAppointment(ctx.db, row.id);
		if (current && current.status !== 'purged') {
			await reconcileAppointment(ctx, current);
		}
	}
}
