import { scanOnce as scan } from '../calendar/sync.js';
import { observeCalendarScan } from '../metrics/calendar.js';

export const scanOnce = observeCalendarScan(scan);
