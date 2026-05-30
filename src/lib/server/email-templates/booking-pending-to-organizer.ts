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
	paragraph
} from './shared';

export function renderBookingPendingToOrganizer(ctx: NotifyContext): Envelope[] {
	const name = eventTypeName(ctx);
	const tz = ctx.cfg.user.timezone;
	const brand = deriveBrand(ctx);
	const acceptUrl = ctx.acceptUrl ?? '';
	const declineUrl = ctx.declineUrl ?? '';

	const body = [
		heading(`Booking request: ${name}`),
		paragraph(
			`${ctx.appointment.attendee_name} <${ctx.appointment.attendee_email}> has requested to book ${name}.`
		),
		detailsList([
			{ label: 'When', value: fmtWhen(ctx.appointment.start_time, ctx.appointment.end_time, tz) },
			{ label: 'Duration', value: ctx.eventType ? `${ctx.eventType.duration} min` : undefined },
			{ label: 'Where', value: ctx.appointment.location ?? undefined }
		]),
		actionRow(
			[
				{ href: acceptUrl, label: 'Accept', kind: 'primary' },
				{ href: declineUrl, label: 'Decline', kind: 'danger' }
			],
			brand.primaryColor ?? ''
		)
	].join('');

	return [
		{
			to: ctx.cfg.user.email,
			subject: `Booking request: ${name} from ${ctx.appointment.attendee_name}`,
			text: lines(
				`${ctx.appointment.attendee_name} <${ctx.appointment.attendee_email}> has requested to book ${name}.`,
				'',
				`When: ${ctx.appointment.start_time}`,
				ctx.eventType ? `Duration: ${ctx.eventType.duration} min` : null,
				ctx.appointment.location ? `Where: ${ctx.appointment.location}` : null,
				'',
				`Accept: ${acceptUrl}`,
				`Decline: ${declineUrl}`
			),
			html: wrap({ brand, body })
		}
	];
}
