import type { EventType, WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import type { BookingLinks } from '@when/jobs';

/**
 * The common domain input every booking-email builder takes. Unlike web (which
 * derives links from a request `baseUrl`), the worker receives precomputed
 * `links` in the job payload and `cfg` from the worker context.
 */
export interface BookingEmailInput {
	cfg: WhenConfiguration;
	appointment: Appointment;
	eventType: EventType | undefined;
	links: BookingLinks;
}
