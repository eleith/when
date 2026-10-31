import { refreshCalendar as refresh } from '../calendar/refresh-calendar.js';
import { reconcileAppointment as reconcile } from '../calendar/reconcile.js';
import { observeRefreshCalendar, observeReconciliation } from '../metrics/calendar.js';

export const refreshCalendar = observeRefreshCalendar(refresh);
export const reconcileAppointment = observeReconciliation(reconcile);
