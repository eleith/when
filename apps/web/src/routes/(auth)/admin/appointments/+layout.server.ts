import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import { countAppointments, listCalendarSyncStatus, listOutOfSyncAppointments } from '@when/db';
import { evaluateCalendarStatuses } from '$lib/server/calendar/health';
import { sql } from 'kysely';
import { Temporal } from '@js-temporal/polyfill';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	const db = getDb();
	const config = getConfig();
	const now = systemClock.now();
	const nowIso = now.toISOString();

	const [pendingCount, upcomingCount, syncStatus, outOfSyncAppts, conflictResult] =
		await Promise.all([
			countAppointments(db, { bucket: 'pending', now }),
			countAppointments(db, { bucket: 'upcoming', now }),
			listCalendarSyncStatus(db),
			listOutOfSyncAppointments(db),
			db
				.selectFrom('appointments')
				.select(sql<number>`count(*)`.as('cnt'))
				.where('status', '=', 'confirmed')
				.where('end_time', '>', nowIso)
				.where('has_possible_conflict', '=', 1)
				.executeTakeFirst()
		]);

	const conflictCount = Number(conflictResult?.cnt ?? 0);
	const calendars = evaluateCalendarStatuses(
		syncStatus,
		outOfSyncAppts,
		config,
		Temporal.Now.instant()
	);

	return {
		pendingCount,
		upcomingCount,
		conflictCount,
		calendars
	};
};
