import { systemClock } from '$lib/server/clock';
import { getDb } from '$lib/server/state';
import { countAppointments, listCalendarSyncStatus } from '@when/db';
import { sql } from 'kysely';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	const db = getDb();
	const now = systemClock.now();
	const nowIso = now.toISOString();

	const [pendingCount, upcomingCount, syncStatus, conflictResult] = await Promise.all([
		countAppointments(db, { bucket: 'pending', now }),
		countAppointments(db, { bucket: 'upcoming', now }),
		listCalendarSyncStatus(db),
		db
			.selectFrom('appointments')
			.select(sql<number>`count(*)`.as('cnt'))
			.where('status', '=', 'confirmed')
			.where('end_time', '>', nowIso)
			.where('has_possible_conflict', '=', 1)
			.executeTakeFirst()
	]);

	const conflictCount = Number(conflictResult?.cnt ?? 0);
	const calendars = syncStatus.map((s) => ({
		id: s.calendar_id,
		health: s.health,
		reason: s.health_reason,
		since: s.health_changed_at
	}));

	return {
		pendingCount,
		upcomingCount,
		conflictCount,
		calendars
	};
};
