import {
	fetchBusyIntervals as fetch,
	pushAppointment as push,
	deleteAppointmentFromCalendar as remove
} from '@when/calendar';
import {
	observeBusyFetch,
	observeCalendarWrite,
	observeCalendarDelete
} from '../metrics/calendar-provider.js';

export const fetchBusyIntervals = observeBusyFetch(fetch);
export const pushAppointment = observeCalendarWrite(push);
export const deleteAppointmentFromCalendar = observeCalendarDelete(remove);
