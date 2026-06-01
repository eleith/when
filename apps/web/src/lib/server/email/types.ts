import type { EventType, WhenConfiguration } from '@when/config';
import type { Appointment } from '../db';

/** The common domain input every booking email builder takes. */
export interface BookingEmailInput {
	cfg: WhenConfiguration;
	appointment: Appointment;
	eventType: EventType | undefined;
	/** Request origin, e.g. `https://when.example.com`. */
	baseUrl: string;
}
