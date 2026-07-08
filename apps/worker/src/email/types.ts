import type { Meeting, WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import type { AppointmentLinks } from '../links.js';
import type { Attachment } from './recipients.js';

export interface AppointmentEmailInput {
	cfg: WhenConfiguration;
	appointment: Appointment;
	eventType: Meeting | undefined;
	links: AppointmentLinks;
	logo: Attachment | null;
	rescheduleReason?: string;
}
