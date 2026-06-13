import type { EventType, WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import type { BookingLinks } from '../links.js';
import type { Attachment } from './recipients.js';

export interface BookingEmailInput {
	cfg: WhenConfiguration;
	appointment: Appointment;
	eventType: EventType | undefined;
	links: BookingLinks;
	logo: Attachment | null;
}
