import type { WhenConfiguration } from '@when/config';
import type { SendAppointmentEmailInput } from '@when/jobs';
import { parseActionLog } from '@when/db';
import { appointmentCancelledByGuest } from './builders/appointment-cancelled-by-guest.js';
import { appointmentCancelledByHost } from './builders/appointment-cancelled-by-host.js';
import { appointmentConfirmed } from './builders/appointment-confirmed.js';
import { appointmentDeclined } from './builders/appointment-declined.js';
import { appointmentPending } from './builders/appointment-pending.js';
import { appointmentRescheduledByGuest } from './builders/appointment-rescheduled-by-guest.js';
import { appointmentRescheduledByHost } from './builders/appointment-rescheduled-by-host.js';
import type { EmailMessage, Envelope } from './recipients.js';
import { renderMessage } from './render.js';
import { appointmentLinks } from '../links.js';
import { fetchBrandLogo } from './logo.js';
import type { AppointmentEmailInput } from './types.js';

function build(i: AppointmentEmailInput, kind: SendAppointmentEmailInput['kind']): EmailMessage[] {
	switch (kind) {
		case 'confirmed':
			return appointmentConfirmed(i);
		case 'pending':
			return appointmentPending(i);
		case 'cancelled-by-guest':
			return appointmentCancelledByGuest(i);
		case 'cancelled-by-host':
			return appointmentCancelledByHost(i);
		case 'rescheduled-by-guest':
			return appointmentRescheduledByGuest(i);
		case 'rescheduled-by-host':
			return appointmentRescheduledByHost(i);
		case 'declined':
			return appointmentDeclined(i);
		default: {
			const unhandled: never = kind;
			throw new Error(`unhandled appointment email kind: ${String(unhandled)}`);
		}
	}
}

export async function dispatch(
	input: SendAppointmentEmailInput,
	cfg: WhenConfiguration
): Promise<Envelope[]> {
	const eventType = cfg.event_types.find((e) => e.id === input.appointment.event_type_id);
	const logo = await fetchBrandLogo(cfg);

	const actionLog = parseActionLog(input.appointment.action_log);
	const rescheduleEntry = actionLog.findLast((e) => e.action === 'reschedule');
	const rescheduleReason = rescheduleEntry?.payload?.note;

	const i: AppointmentEmailInput = {
		cfg,
		appointment: input.appointment,
		eventType,
		links: appointmentLinks({ baseUrl: cfg.url.app, appointment: input.appointment }),
		logo,
		rescheduleReason
	};

	return build(i, input.kind).map((m) => renderMessage(m, logo));
}
