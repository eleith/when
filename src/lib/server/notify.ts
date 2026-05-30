import type { EventType, WhenConfiguration } from './config/schema';
import type { Appointment } from './db';
import { buildIcs } from './ics';
import { sendEmail } from './smtp';

export type NotifyVariant =
	| 'booking_confirmed'
	| 'booking_pending_to_organizer'
	| 'booking_pending_to_attendee'
	| 'booking_cancelled_by_attendee'
	| 'booking_cancelled_by_organizer'
	| 'booking_rescheduled_by_attendee'
	| 'booking_declined';

export interface NotifyContext {
	cfg: WhenConfiguration;
	appointment: Appointment;
	eventType: EventType | undefined;
	/** Public cancel route: `/booked/[id]/cancel?token=…`. Empty for variants that don't surface it. */
	cancelUrl: string;
	/** Public reschedule route: `/booked/[id]/reschedule?token=…`. Empty for variants that don't surface it. */
	rescheduleUrl: string;
	/** Public booking landing page: `/booked/[id]?token=…`. Empty for variants that don't surface it. */
	bookedUrl: string;
	/** Admin accept URL — set for `booking_pending_to_organizer`. */
	acceptUrl?: string;
	/** Admin decline URL — set for `booking_pending_to_organizer`. */
	declineUrl?: string;
}

export interface NotifyResult {
	ok: boolean;
	skipped: boolean;
}

interface Attachment {
	filename: string;
	content: string;
	contentType: string;
}

interface Envelope {
	to: string;
	subject: string;
	text: string;
	html?: string;
	attachments?: Attachment[];
}

interface NotifySpec {
	envelopes(ctx: NotifyContext): Envelope[];
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

function attendeeIcs(ctx: NotifyContext): Attachment {
	return {
		filename: `${ctx.appointment.id}.ics`,
		content: buildIcs({
			appointment: { ...ctx.appointment, status: 'confirmed' },
			eventTypeName: eventTypeName(ctx),
			organizerName: ctx.cfg.user.name,
			organizerEmail: ctx.cfg.user.email,
			cancelUrl: ctx.bookedUrl,
			method: 'REQUEST'
		}),
		contentType: 'text/calendar; charset=utf-8'
	};
}

function cancelIcs(ctx: NotifyContext): Attachment {
	return {
		filename: `${ctx.appointment.id}.ics`,
		content: buildIcs({
			appointment: ctx.appointment,
			eventTypeName: eventTypeName(ctx),
			organizerName: ctx.cfg.user.name,
			organizerEmail: ctx.cfg.user.email,
			cancelUrl: ctx.bookedUrl,
			method: 'CANCEL'
		}),
		contentType: 'text/calendar; charset=utf-8'
	};
}

const registry: Record<NotifyVariant, NotifySpec> = {
	booking_confirmed: {
		envelopes(ctx) {
			const name = eventTypeName(ctx);
			return [
				{
					to: ctx.appointment.attendee_email,
					subject: `Confirmed: ${name} with ${ctx.cfg.user.name}`,
					text: lines(
						`Your booking is confirmed.`,
						``,
						`What: ${name}`,
						whenLine(ctx.appointment),
						whereLine(ctx.appointment),
						``,
						`Reschedule: ${ctx.rescheduleUrl}`,
						`Cancel: ${ctx.cancelUrl}`
					),
					attachments: [attendeeIcs(ctx)]
				},
				{
					to: ctx.cfg.user.email,
					subject: `New booking: ${name} with ${ctx.appointment.attendee_name}`,
					text: lines(
						`${ctx.appointment.attendee_name} <${ctx.appointment.attendee_email}> just booked ${name}.`,
						``,
						whenLine(ctx.appointment),
						whereLine(ctx.appointment),
						ctx.appointment.attendee_notes ? `\nNotes: ${ctx.appointment.attendee_notes}` : null
					)
				}
			];
		}
	},

	booking_pending_to_attendee: {
		envelopes(ctx) {
			const name = eventTypeName(ctx);
			return [
				{
					to: ctx.appointment.attendee_email,
					subject: `Booking request received: ${name} with ${ctx.cfg.user.name}`,
					text: lines(
						`Thanks — we got your request to book ${name}.`,
						``,
						`${ctx.cfg.user.name} will review and confirm. You'll get a follow-up email at ${ctx.appointment.attendee_email} with the outcome.`,
						``,
						whenLine(ctx.appointment),
						whereLine(ctx.appointment),
						``,
						`Need to change something before then?`,
						`Reschedule: ${ctx.rescheduleUrl}`,
						`Cancel: ${ctx.cancelUrl}`
					)
				}
			];
		}
	},

	booking_pending_to_organizer: {
		envelopes(ctx) {
			const name = eventTypeName(ctx);
			return [
				{
					to: ctx.cfg.user.email,
					subject: `Booking request: ${name} from ${ctx.appointment.attendee_name}`,
					text:
						`${ctx.appointment.attendee_name} <${ctx.appointment.attendee_email}> has requested to book ${name}.\n\n` +
						`When: ${ctx.appointment.start_time}\n` +
						(ctx.eventType ? `Duration: ${ctx.eventType.duration} min\n` : '') +
						(ctx.appointment.location ? `Where: ${ctx.appointment.location}\n\n` : '\n') +
						`Accept: ${ctx.acceptUrl ?? ''}\n` +
						`Decline: ${ctx.declineUrl ?? ''}\n`
				}
			];
		}
	},

	booking_cancelled_by_attendee: {
		envelopes(ctx) {
			const name = eventTypeName(ctx);
			return [
				{
					to: ctx.appointment.attendee_email,
					subject: `Cancelled: ${name} with ${ctx.cfg.user.name}`,
					text: lines(
						`Your booking has been cancelled.`,
						``,
						`What: ${name}`,
						whenLine(ctx.appointment)
					),
					attachments: [cancelIcs(ctx)]
				},
				{
					to: ctx.cfg.user.email,
					subject: `Cancelled: ${name} with ${ctx.appointment.attendee_name}`,
					text: lines(
						`${ctx.appointment.attendee_name} <${ctx.appointment.attendee_email}> cancelled ${name}.`,
						``,
						whenLine(ctx.appointment)
					)
				}
			];
		}
	},

	booking_cancelled_by_organizer: {
		envelopes(ctx) {
			const name = eventTypeName(ctx);
			return [
				{
					to: ctx.appointment.attendee_email,
					subject: `Cancelled: ${name} with ${ctx.cfg.user.name}`,
					text: lines(
						`${ctx.cfg.user.name} cancelled this booking.`,
						``,
						`What: ${name}`,
						whenLine(ctx.appointment)
					),
					attachments: [cancelIcs(ctx)]
				},
				{
					to: ctx.cfg.user.email,
					subject: `Cancelled: ${name} with ${ctx.appointment.attendee_name}`,
					text: lines(
						`You cancelled ${ctx.appointment.attendee_name}'s <${ctx.appointment.attendee_email}> booking for ${name}.`,
						``,
						whenLine(ctx.appointment)
					)
				}
			];
		}
	},

	booking_rescheduled_by_attendee: {
		envelopes(ctx) {
			const name = eventTypeName(ctx);
			return [
				{
					to: ctx.appointment.attendee_email,
					subject: `Rescheduled: ${name} with ${ctx.cfg.user.name}`,
					text: lines(
						`Your booking has been moved to a new time.`,
						``,
						`What: ${name}`,
						whenLine(ctx.appointment),
						whereLine(ctx.appointment),
						``,
						`Reschedule again: ${ctx.rescheduleUrl}`,
						`Cancel: ${ctx.cancelUrl}`
					),
					attachments: [attendeeIcs(ctx)]
				},
				{
					to: ctx.cfg.user.email,
					subject: `Rescheduled: ${name} with ${ctx.appointment.attendee_name}`,
					text: lines(
						`${ctx.appointment.attendee_name} <${ctx.appointment.attendee_email}> rescheduled ${name}.`,
						``,
						whenLine(ctx.appointment)
					)
				}
			];
		}
	},

	booking_declined: {
		envelopes(ctx) {
			const name = eventTypeName(ctx);
			return [
				{
					to: ctx.appointment.attendee_email,
					subject: `Declined: ${name} with ${ctx.cfg.user.name}`,
					text: lines(
						`Your booking request was declined.`,
						``,
						`What: ${name}`,
						whenLine(ctx.appointment)
					)
				},
				{
					to: ctx.cfg.user.email,
					subject: `Declined: ${name} from ${ctx.appointment.attendee_name}`,
					text: lines(
						`You declined ${ctx.appointment.attendee_name}'s <${ctx.appointment.attendee_email}> request for ${name}.`,
						``,
						whenLine(ctx.appointment)
					)
				}
			];
		}
	}
};

export async function notify(variant: NotifyVariant, ctx: NotifyContext): Promise<NotifyResult> {
	if (!ctx.cfg.smtp) return SKIP;
	const envelopes = registry[variant].envelopes(ctx);
	const results = await Promise.all(envelopes.map((e) => sendEmail(e)));
	return { ok: results.every((r) => r.ok), skipped: false };
}
