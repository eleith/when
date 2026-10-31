import { findCalendar } from '@when/config';
import type { refreshCalendar } from '../calendar/refresh-calendar.js';
import type { reconcileAppointment } from '../calendar/reconcile.js';
import type { scanOnce } from '../calendar/sync.js';
import { calendarRefreshTotal, calendarSyncDuration, calendarSyncTotal } from './registry.js';

export function observeRefreshCalendar(operation: typeof refreshCalendar): typeof refreshCalendar {
	return async (ctx, cal, window, opts) => {
		const result = await operation(ctx, cal, window, opts);
		const status = result.ok ? 'success' : 'failure';
		calendarRefreshTotal.inc({
			calendar_id: cal.name,
			provider_type: cal.provider.type,
			status
		});
		return result;
	};
}

export function observeReconciliation(
	operation: typeof reconcileAppointment
): typeof reconcileAppointment {
	return async (ctx, row) => {
		if (row.status === 'purged') return operation(ctx, row);
		const target =
			row.external_calendar_id ?? ctx.config.meetings[row.event_type_id]?.booking_calendar;
		const calendar = target ? findCalendar(ctx.config, target) : undefined;
		const stop = calendarSyncDuration.startTimer({ provider_type: calendar?.type ?? 'unknown' });
		try {
			return await operation(ctx, row);
		} finally {
			stop();
		}
	};
}

export function observeCalendarScan(operation: typeof scanOnce): typeof scanOnce {
	return async (ctx) => {
		try {
			await operation(ctx);
		} catch (error) {
			calendarSyncTotal.inc({ status: 'failure' });
			throw error;
		}
		calendarSyncTotal.inc({ status: 'success' });
	};
}
