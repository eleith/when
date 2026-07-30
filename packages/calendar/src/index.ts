// @when/calendar — external-calendar I/O for the worker (web consumes it too,
// but only the light, tree-shakeable read/build paths — never heavy provider work
// on a request).

// ICS document building.
export { buildIcs } from './ics.js';
export { icsValue, icsParameter } from './text.js';
export type { IcsInput, IcsMethod } from './ics.js';
export type { Clock } from './clock.js';

// Shared calendar event fields (Google + ICS).
export { describeAppointment } from './description.js';
export { guestContact } from './guest.js';
export type { CalendarGuest } from './guest.js';

// Worker refresh: fetch + expand one calendar's busy intervals, filtering our own events.
export { fetchBusyIntervals } from './busy.js';

// Pushing appointments to a destination calendar.
export { pushAppointment, deleteAppointmentFromCalendar } from './push.js';
export type { PushOptions, PushResult, DeleteResult } from './push.js';

// Adapters and shared calendar types.
export { getCalendarAdapter } from './adapter.js';
export type { CalendarAdapter, ConnectedService, ConnectedGoogleService } from './adapter.js';
export type { BusyEvent, Interval } from './types.js';
export type { ExpandWindow } from './expand.js';

// Provider connect + discovery — used to authenticate a service, run the OAuth
// consent flow, and list available calendars without a calendar-bound adapter
// (the CLI today; a web connect/test UI could consume the same paths).
export {
	getGoogleAccessToken,
	buildGoogleAuthUrl,
	exchangeGoogleAuthCode,
	listGoogleCalendars
} from './adapters/google.js';
export type {
	GoogleConfig,
	GoogleTokens,
	GoogleCalendarItem,
	GoogleAuthUrlOptions
} from './adapters/google.js';
export { verifyCalDavService, discoverCalDavCalendars } from './adapters/caldav.js';
export type { CalDavCalendarItem } from './adapters/caldav.js';

// Logger injection — the host installs its logger once at startup.
export { setLogger } from './logger.js';
export type { Logger } from './logger.js';
