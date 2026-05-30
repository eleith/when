import type { Envelope, NotifyContext } from '../notify';
import { buildIcs } from '../ics';
import { wrap } from './layout';
import {
	deriveBrand,
	detailsList,
	eventTypeName,
	fmtWhen,
	heading,
	lines,
	paragraph
} from './shared';

function cancelIcs(ctx: NotifyContext) {
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

export function renderBookingCancelledByAttendee(ctx: NotifyContext): Envelope[] {
	const name = eventTypeName(ctx);
	const tz = ctx.cfg.user.timezone;
	const brand = deriveBrand(ctx);

	const attendeeBody = [
		heading('Your booking has been cancelled.'),
		detailsList([
			{ label: 'What', value: name },
			{ label: 'When', value: fmtWhen(ctx.appointment.start_time, ctx.appointment.end_time, tz) }
		])
	].join('');

	const adminBody = [
		heading(`Cancelled: ${name}`),
		paragraph(
			`${ctx.appointment.attendee_name} <${ctx.appointment.attendee_email}> cancelled ${name}.`
		),
		detailsList([
			{ label: 'When', value: fmtWhen(ctx.appointment.start_time, ctx.appointment.end_time, tz) }
		])
	].join('');

	return [
		{
			to: ctx.appointment.attendee_email,
			subject: `Cancelled: ${name} with ${ctx.cfg.user.name}`,
			text: lines(
				'Your booking has been cancelled.',
				'',
				`What: ${name}`,
				`When: ${ctx.appointment.start_time}`
			),
			html: wrap({ brand, body: attendeeBody }),
			attachments: [cancelIcs(ctx)]
		},
		{
			to: ctx.cfg.user.email,
			subject: `Cancelled: ${name} with ${ctx.appointment.attendee_name}`,
			text: lines(
				`${ctx.appointment.attendee_name} <${ctx.appointment.attendee_email}> cancelled ${name}.`,
				'',
				`When: ${ctx.appointment.start_time}`
			),
			html: wrap({ brand, body: adminBody })
		}
	];
}
