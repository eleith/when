import type { Kysely } from 'kysely';
import { resolveBookingActions } from './actions';
import { createNotificationTracker } from './side-effects';
import { transitionStatus } from './status';
import { pushAppointment } from '../calendar/push';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '../config/schema';
import type { Appointment, Database } from '../db';
import { notify } from '../notify';

export interface AcceptAppointmentDeps {
	db: Kysely<Database>;
	cfg: WhenConfiguration;
	clock: Clock;
}

export interface AcceptAppointmentInput {
	appointment: Appointment;
	baseUrl: string;
}

export type AcceptAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' };

export async function acceptAppointment(
	deps: AcceptAppointmentDeps,
	input: AcceptAppointmentInput
): Promise<AcceptAppointmentResult> {
	const eventType = deps.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

	const gate = resolveBookingActions({
		row: input.appointment,
		viewer: 'organizer',
		now: deps.clock.now(),
		eventType
	}).accept;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	const transition = await transitionStatus(
		{ db: deps.db, clock: deps.clock },
		{ id: input.appointment.id, from: ['pending'], to: 'confirmed' }
	);
	if (!transition.ok) return { ok: false, reason: 'conflict' };

	let row = transition.row;
	const tracker = createNotificationTracker(row.notification_status);
	const token = encodeURIComponent(row.cancel_token);
	const bookedUrl = `${input.baseUrl}/booked/${row.id}?token=${token}`;
	const cancelUrl = `${input.baseUrl}/booked/${row.id}/cancel?token=${token}`;
	const rescheduleUrl = `${input.baseUrl}/booked/${row.id}/reschedule?token=${token}`;

	let externalUpdate: { external_event_id: string; external_calendar_id: string } | null = null;
	if (eventType) {
		const pushed = await tracker.run('calendar_push', () =>
			pushAppointment(deps.cfg, row, eventType.destination_calendar, { cancelUrl: bookedUrl })
		);
		if (pushed.ok) {
			externalUpdate = {
				external_event_id: pushed.externalEventId,
				external_calendar_id: pushed.externalCalendarId
			};
		}
	}

	await tracker.run('email', () =>
		notify('booking_confirmed', {
			cfg: deps.cfg,
			appointment: row,
			eventType,
			cancelUrl,
			rescheduleUrl,
			bookedUrl
		})
	);

	if (externalUpdate !== null || tracker.changed()) {
		await deps.db
			.updateTable('appointments')
			.set({
				...(externalUpdate ?? {}),
				notification_status: tracker.status(),
				updated_at: deps.clock.now().toISOString()
			})
			.where('id', '=', row.id)
			.execute();
		row = { ...row, ...(externalUpdate ?? {}), notification_status: tracker.status() };
	}

	return { ok: true, appointment: row };
}
