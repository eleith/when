// @when/calendar — external-calendar I/O for the worker (web consumes it too,
// but only the light, tree-shakeable read/build paths — never heavy provider work
// on a request).

// ICS document building.
export { buildIcs } from './ics.js';
export type { IcsInput, IcsMethod } from './ics.js';
export type { Clock } from './clock.js';

// Worker refresh: fetch + expand one calendar's busy intervals, filtering our own events.
export { fetchBusyIntervals } from './busy.js';

// Pushing appointments to a destination calendar.
export { pushAppointment, deleteAppointmentFromCalendar } from './push.js';
export type { PushOptions, PushResult, DeleteResult } from './push.js';

// Adapters and shared calendar types.
export { getCalendarAdapter } from './adapter.js';
export type { CalendarAdapter, FetchFn } from './adapter.js';
export type { BusyEvent, Interval } from './types.js';
export type { ExpandWindow } from './expand.js';

// Logger injection — the host installs its logger once at startup.
export { setLogger } from './logger.js';
export type { Logger } from './logger.js';
