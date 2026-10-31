import { Counter, Registry } from '@prometheus-io/client';

export const register = new Registry();
register.setDefaultLabels({ app: 'when', service: 'web' });

export const bookingAttemptsTotal = new Counter({
	name: 'when_booking_attempts_total',
	help: 'Total number of visitor booking attempts.',
	labelNames: ['event_type_id', 'status'],
	registers: [register]
});

export const userLoginsTotal = new Counter({
	name: 'when_user_logins_total',
	help: 'Total number of host dashboard login attempts.',
	labelNames: ['provider', 'status'],
	registers: [register]
});

export const icsDownloadsTotal = new Counter({
	name: 'when_ics_downloads_total',
	help: 'Total number of ICS calendar invite downloads.',
	labelNames: ['status'],
	registers: [register]
});

export const appointmentOperationsTotal = new Counter({
	name: 'when_appointment_operations_total',
	help: 'Appointment operation outcomes, not committed changes.',
	labelNames: ['action', 'actor', 'status'],
	registers: [register]
});

export const operationFailuresTotal = new Counter({
	name: 'when_operation_failures_total',
	help: 'Failed operation attempts by bounded operation and failure code.',
	labelNames: ['operation', 'code'],
	registers: [register]
});
