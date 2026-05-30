import type { Envelope, NotifyContext } from '../notify';
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

export function renderBookingPendingToAttendee(ctx: NotifyContext): Envelope[] {
	const name = eventTypeName(ctx);
	const tz = ctx.cfg.user.timezone;
	const brand = deriveBrand(ctx);

	const body = [
		heading(`Booking request received: ${name}`),
		paragraph(
			`${ctx.cfg.user.name} will review and confirm. You'll get a follow-up email at ${ctx.appointment.attendee_email} with the outcome.`
		),
		detailsList([
			{ label: 'When', value: fmtWhen(ctx.appointment.start_time, ctx.appointment.end_time, tz) },
			{ label: 'Where', value: ctx.appointment.location ?? undefined }
		]),
		paragraph('Need to change something before then?'),
		actionRow(
			[
				{ href: ctx.rescheduleUrl, label: 'Reschedule', kind: 'secondary' },
				{ href: ctx.cancelUrl, label: 'Cancel', kind: 'danger' }
			],
			brand.primaryColor ?? ''
		)
	].join('');

	return [
		{
			to: ctx.appointment.attendee_email,
			subject: `Booking request received: ${name} with ${ctx.cfg.user.name}`,
			text: lines(
				`Thanks — we got your request to book ${name}.`,
				'',
				`${ctx.cfg.user.name} will review and confirm. You'll get a follow-up email at ${ctx.appointment.attendee_email} with the outcome.`,
				'',
				`When: ${ctx.appointment.start_time}`,
				ctx.appointment.location ? `Where: ${ctx.appointment.location}` : null,
				'',
				'Need to change something before then?',
				`Reschedule: ${ctx.rescheduleUrl}`,
				`Cancel: ${ctx.cancelUrl}`
			),
			html: wrap({
				brand,
				body,
				footer: viewBookingFooter(ctx.bookedUrl)
			})
		}
	];
}
