import type { EventType, WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import type { BookingLinks } from '../links.js';

export interface BookingEmailInput {
	cfg: WhenConfiguration;
	appointment: Appointment;
	eventType: EventType | undefined;
	links: BookingLinks;
}
