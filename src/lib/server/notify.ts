import type { EventType, WhenConfiguration } from './config/schema';
import type { Appointment } from './db';
import { buildIcs } from './ics';
import { sendEmail } from './smtp';

export interface NotifyContext {
	cfg: WhenConfiguration;
	appointment: Appointment;
	eventType: EventType | undefined;
	cancelUrl: string;
}

/**
 * Result of a multi-recipient notify call. `ok` is true when every
 * configured send succeeded; if SMTP is not configured at all, `ok` is
 * also true (nothing to send), `skipped` is true.
 */
export interface NotifyResult {
	ok: boolean;
	skipped: boolean;
}

const SKIP: NotifyResult = { ok: true, skipped: true };

function lines(...parts: (string | false | null | undefined)[]): string {
	return parts.filter(Boolean).join('\n');
}

function eventTypeName(ctx: NotifyContext): string {
	return ctx.eventType?.name ?? ctx.appointment.event_type_id;
}

function whenLine(appointment: Appointment): string {
	return `When: ${appointment.start_time}`;
}

function whereLine(appointment: Appointment): string | null {
	return appointment.location ? `Where: ${appointment.location}` : null;
}

function attendeeIcs(ctx: NotifyContext) {
	return {
		filename: `${ctx.appointment.id}.ics`,
		content: buildIcs({
			appointment: { ...ctx.appointment, status: 'confirmed' },
			eventTypeName: eventTypeName(ctx),
			organizerName: ctx.cfg.user.name,
			organizerEmail: ctx.cfg.user.email,
			cancelUrl: ctx.cancelUrl
		}),
		contentType: 'text/calendar; charset=utf-8'
	};
}

/**
 * Auto-book confirmation: notify both attendee (with .ics) and admin.
 */
export async function notifyBookingConfirmed(ctx: NotifyContext): Promise<NotifyResult> {
	if (!ctx.cfg.smtp) return SKIP;
	const name = eventTypeName(ctx);
	const [attendee, admin] = await Promise.all([
		sendEmail({
			to: ctx.appointment.attendee_email,
			subject: `Confirmed: ${name} with ${ctx.cfg.user.name}`,
			text: lines(
				`Your booking is confirmed.`,
				``,
				`What: ${name}`,
				whenLine(ctx.appointment),
				whereLine(ctx.appointment),
				``,
				`Cancel or reschedule: ${ctx.cancelUrl}`
			),
			attachments: [attendeeIcs(ctx)]
		}),
		sendEmail({
			to: ctx.cfg.user.email,
			subject: `New booking: ${name} with ${ctx.appointment.attendee_name}`,
			text: lines(
				`${ctx.appointment.attendee_name} <${ctx.appointment.attendee_email}> just booked ${name}.`,
				``,
				whenLine(ctx.appointment),
				whereLine(ctx.appointment),
				ctx.appointment.attendee_notes ? `\nNotes: ${ctx.appointment.attendee_notes}` : null
			)
		})
	]);
	return { ok: attendee.ok && admin.ok, skipped: false };
}

/**
 * Cancellation: notify both attendee and admin.
 */
export async function notifyBookingCancelled(ctx: NotifyContext): Promise<NotifyResult> {
	if (!ctx.cfg.smtp) return SKIP;
	const name = eventTypeName(ctx);
	const [attendee, admin] = await Promise.all([
		sendEmail({
			to: ctx.appointment.attendee_email,
			subject: `Cancelled: ${name} with ${ctx.cfg.user.name}`,
			text: lines(
				`Your booking has been cancelled.`,
				``,
				`What: ${name}`,
				whenLine(ctx.appointment)
			)
		}),
		sendEmail({
			to: ctx.cfg.user.email,
			subject: `Cancelled: ${name} with ${ctx.appointment.attendee_name}`,
			text: lines(
				`${ctx.appointment.attendee_name} <${ctx.appointment.attendee_email}> cancelled ${name}.`,
				``,
				whenLine(ctx.appointment)
			)
		})
	]);
	return { ok: attendee.ok && admin.ok, skipped: false };
}

/**
 * Reschedule: notify both attendee (with new .ics) and admin.
 */
export async function notifyBookingRescheduled(ctx: NotifyContext): Promise<NotifyResult> {
	if (!ctx.cfg.smtp) return SKIP;
	const name = eventTypeName(ctx);
	const [attendee, admin] = await Promise.all([
		sendEmail({
			to: ctx.appointment.attendee_email,
			subject: `Rescheduled: ${name} with ${ctx.cfg.user.name}`,
			text: lines(
				`Your booking has been moved to a new time.`,
				``,
				`What: ${name}`,
				whenLine(ctx.appointment),
				whereLine(ctx.appointment),
				``,
				`Cancel or reschedule again: ${ctx.cancelUrl}`
			),
			attachments: [attendeeIcs(ctx)]
		}),
		sendEmail({
			to: ctx.cfg.user.email,
			subject: `Rescheduled: ${name} with ${ctx.appointment.attendee_name}`,
			text: lines(
				`${ctx.appointment.attendee_name} <${ctx.appointment.attendee_email}> rescheduled ${name}.`,
				``,
				whenLine(ctx.appointment)
			)
		})
	]);
	return { ok: attendee.ok && admin.ok, skipped: false };
}
