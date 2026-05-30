import type { Envelope, NotifyContext } from '../notify';
import { buildIcs } from '../ics';
import { wrap } from './layout';
import {
	actionRow,
	deriveBrand,
	detailsList,
	eventTypeName,
	fmtWhen,
	heading,
	lines,
	paragraph,
	viewBookingFooter
} from './shared';

function attendeeIcs(ctx: NotifyContext) {
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

export function renderBookingRescheduledByOrganizer(ctx: NotifyContext): Envelope[] {
	const name = eventTypeName(ctx);
	const tz = ctx.cfg.user.timezone;
	const brand = deriveBrand(ctx);

	const attendeeBody = [
		heading(`${ctx.cfg.user.name} moved this booking to a new time.`),
		detailsList([
			{ label: 'What', value: name },
			{ label: 'When', value: fmtWhen(ctx.appointment.start_time, ctx.appointment.end_time, tz) },
			{ label: 'Where', value: ctx.appointment.location ?? undefined }
		]),
		actionRow(
			[
				{ href: ctx.rescheduleUrl, label: 'Reschedule', kind: 'secondary' },
				{ href: ctx.cancelUrl, label: 'Cancel', kind: 'danger' }
			],
			brand.primaryColor ?? ''
		)
	].join('');

	const adminBody = [
		heading(`Rescheduled: ${name}`),
		paragraph(
			`You rescheduled ${ctx.appointment.attendee_name}'s <${ctx.appointment.attendee_email}> booking for ${name}.`
		),
		detailsList([
			{ label: 'When', value: fmtWhen(ctx.appointment.start_time, ctx.appointment.end_time, tz) }
		])
	].join('');

	return [
		{
			to: ctx.appointment.attendee_email,
			subject: `Rescheduled: ${name} with ${ctx.cfg.user.name}`,
			text: lines(
				`${ctx.cfg.user.name} moved this booking to a new time.`,
				'',
				`What: ${name}`,
				`When: ${ctx.appointment.start_time}`,
				ctx.appointment.location ? `Where: ${ctx.appointment.location}` : null,
				'',
				`Reschedule: ${ctx.rescheduleUrl}`,
				`Cancel: ${ctx.cancelUrl}`
			),
			html: wrap({
				brand,
				body: attendeeBody,
				footer: viewBookingFooter(ctx.bookedUrl)
			}),
			attachments: [attendeeIcs(ctx)]
		},
		{
			to: ctx.cfg.user.email,
			subject: `Rescheduled: ${name} with ${ctx.appointment.attendee_name}`,
			text: lines(
				`You rescheduled ${ctx.appointment.attendee_name}'s <${ctx.appointment.attendee_email}> booking for ${name}.`,
				'',
				`When: ${ctx.appointment.start_time}`
			),
			html: wrap({ brand, body: adminBody })
		}
	];
}
