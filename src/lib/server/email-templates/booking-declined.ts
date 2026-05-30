import type { Envelope, NotifyContext } from '../notify';
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

export function renderBookingDeclined(ctx: NotifyContext): Envelope[] {
	const name = eventTypeName(ctx);
	const tz = ctx.cfg.user.timezone;
	const brand = deriveBrand(ctx);

	const attendeeBody = [
		heading('Your booking request was declined.'),
		detailsList([
			{ label: 'What', value: name },
			{ label: 'When', value: fmtWhen(ctx.appointment.start_time, ctx.appointment.end_time, tz) }
		])
	].join('');

	const adminBody = [
		heading(`Declined: ${name}`),
		paragraph(
			`You declined ${ctx.appointment.attendee_name}'s <${ctx.appointment.attendee_email}> request for ${name}.`
		),
		detailsList([
			{ label: 'When', value: fmtWhen(ctx.appointment.start_time, ctx.appointment.end_time, tz) }
		])
	].join('');

	return [
		{
			to: ctx.appointment.attendee_email,
			subject: `Declined: ${name} with ${ctx.cfg.user.name}`,
			text: lines(
				'Your booking request was declined.',
				'',
				`What: ${name}`,
				`When: ${ctx.appointment.start_time}`
			),
			html: wrap({ brand, body: attendeeBody })
		},
		{
			to: ctx.cfg.user.email,
			subject: `Declined: ${name} from ${ctx.appointment.attendee_name}`,
			text: lines(
				`You declined ${ctx.appointment.attendee_name}'s <${ctx.appointment.attendee_email}> request for ${name}.`,
				'',
				`When: ${ctx.appointment.start_time}`
			),
			html: wrap({ brand, body: adminBody })
		}
	];
}
