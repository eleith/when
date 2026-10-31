import type {
	fetchBusyIntervals,
	pushAppointment,
	deleteAppointmentFromCalendar
} from '@when/calendar';
import { findCalendar } from '@when/config';
import { operationFailuresTotal } from './registry.js';

export function observeBusyFetch(operation: typeof fetchBusyIntervals): typeof fetchBusyIntervals {
	return async (calendar, window, options) => {
		try {
			return await operation(calendar, window, options);
		} catch (error) {
			operationFailuresTotal.inc({ operation: 'calendar_refresh', code: 'provider_error' });
			throw error;
		}
	};
}

export function observeCalendarWrite(operation: typeof pushAppointment): typeof pushAppointment {
	return async (config, appointment, calendarId, options) => {
		const result = await operation(config, appointment, calendarId, options);
		if (!result.ok) {
			const code = findCalendar(config, calendarId) ? 'provider_error' : 'not_configured';
			operationFailuresTotal.inc({ operation: 'calendar_write', code });
		}
		return result;
	};
}

export function observeCalendarDelete(
	operation: typeof deleteAppointmentFromCalendar
): typeof deleteAppointmentFromCalendar {
	return async (config, calendarId, eventId) => {
		const result = await operation(config, calendarId, eventId);
		if (!result.ok) {
			const code = findCalendar(config, calendarId) ? 'provider_error' : 'not_configured';
			operationFailuresTotal.inc({ operation: 'calendar_delete', code });
		}
		return result;
	};
}
