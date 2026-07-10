import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import { toAppointmentView } from '$lib/server/appointments';
import { evaluateCalendarStatuses } from '$lib/server/calendar/health';
import { signOutAction } from '$lib/server/auth';
import {
	countAppointments,
	listAppointmentsPage,
	listCalendarSyncStatus,
	listOutOfSyncAppointments
} from '@when/db';
import { sql } from 'kysely';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const db = getDb();
	const cfg = getConfig();
	const now = systemClock.now();

	const todayStart = new Date(now);
	todayStart.setHours(0, 0, 0, 0);
	const todayEnd = new Date(todayStart);
	todayEnd.setDate(todayEnd.getDate() + 1);

	const weekStart = new Date(todayStart);
	weekStart.setDate(weekStart.getDate() - weekStart.getDay());

	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

	const [
		pendingCount,
		upcomingCount,
		upcomingToday,
		pendingPreview,
		syncStatus,
		outOfSyncAppts,
		conflictResult,
		confirmedWeekRes,
		totalMonthRes,
		lifetimeRes,
		lifetimeMinRes
	] = await Promise.all([
		countAppointments(db, { bucket: 'pending', now }),
		countAppointments(db, { bucket: 'upcoming', now }),
		listAppointmentsPage(db, { bucket: 'upcoming', now, limit: 5, offset: 0 }),
		listAppointmentsPage(db, { bucket: 'pending', now, limit: 5, offset: 0 }),
		listCalendarSyncStatus(db),
		listOutOfSyncAppointments(db),
		db
			.selectFrom('appointments')
			.select(sql<number>`count(*)`.as('cnt'))
			.where('status', '=', 'confirmed')
			.where('end_time', '>', now.toISOString())
			.where('has_possible_conflict', '=', 1)
			.executeTakeFirst(),
		db
			.selectFrom('appointments')
			.select(
				sql<number>`sum(cast((julianday(end_time) - julianday(start_time)) * 24 * 60 as integer))`.as(
					'minutes'
				)
			)
			.where('status', '=', 'confirmed')
			.where('start_time', '>=', weekStart.toISOString())
			.where(
				'end_time',
				'<=',
				new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
			)
			.executeTakeFirst(),
		db
			.selectFrom('appointments')
			.select(sql<number>`count(*)`.as('cnt'))
			.where('start_time', '>=', monthStart.toISOString())
			.where('status', 'in', [
				'confirmed',
				'pending',
				'declined',
				'cancelled',
				'expired',
				'rescheduled'
			])
			.executeTakeFirst(),
		db
			.selectFrom('appointments')
			.select(sql<number>`count(*)`.as('cnt'))
			.where('status', 'not in', ['purged'])
			.executeTakeFirst(),
		db
			.selectFrom('appointments')
			.select(
				sql<number>`sum(cast((julianday(end_time) - julianday(start_time)) * 24 * 60 as integer))`.as(
					'minutes'
				)
			)
			.where('status', '=', 'confirmed')
			.executeTakeFirst()
	]);

	const conflictCount = Number(conflictResult?.cnt ?? 0);
	const confirmedMinutesThisWeek = Number(confirmedWeekRes?.minutes ?? 0);
	const totalThisMonth = Number(totalMonthRes?.cnt ?? 0);
	const lifetimeMeetings = Number(lifetimeRes?.cnt ?? 0);
	const lifetimeMinutes = Number(lifetimeMinRes?.minutes ?? 0);

	const calendars = evaluateCalendarStatuses(
		syncStatus,
		outOfSyncAppts,
		cfg,
		Temporal.Now.instant()
	);

	return {
		calendars,
		conflictCount,
		upcomingCount,
		pendingCount,
		upcoming: upcomingToday.map((r) => toAppointmentView(r, cfg, now)),
		pending: pendingPreview.map((r) => toAppointmentView(r, cfg, now)),
		confirmedMinutesThisWeek,
		totalThisMonth,
		lifetimeMeetings,
		lifetimeMinutes
	};
};

export const actions: Actions = {
	signout: signOutAction
};
