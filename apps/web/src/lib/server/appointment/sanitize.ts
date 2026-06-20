import { parseAttendeeAnswers, type EventType, type Location } from '@when/config';
import { parseActionLog, type ActionLogEntry, type Appointment } from '@when/db';
import type { ChannelNotification } from '$lib/notifications';

export interface PublicEventType {
	id: string;
	name: string;
	slug: string;
	duration: number;
	description: string | null;
	visibility: 'public' | 'private';
	appointment_flow: 'auto' | 'requires_confirmation';
	location: Location | null;
	buffer_before?: number;
	buffer_after?: number;
	minimum_notice?: number;
}

export interface PublicAppointment {
	id: string;
	start_time: string;
	end_time: string;
	attendee_name: string;
	attendee_email: string | null;
	answers: ReturnType<typeof parseAttendeeAnswers>;
	location: string | null;
	status: string;
	action_log: ActionLogEntry[];
	notifications?: ChannelNotification[];
	email_notification_status?: string | null;
	calendar_push_notification_status?: string | null;
}

export function toPublicEventType(
	eventType: EventType,
	isAdmin: boolean,
	settings?: { buffer_before: number; buffer_after: number; minimum_notice: number }
): PublicEventType {
	return {
		id: eventType.id,
		name: eventType.name,
		slug: eventType.slug,
		duration: eventType.duration,
		description: eventType.description ?? null,
		visibility: eventType.visibility ?? 'public',
		appointment_flow: eventType.appointment_flow,
		// Statically configured fixed location only visible to admins
		location: isAdmin ? (eventType.location ?? null) : null,
		...(settings
			? {
					buffer_before: settings.buffer_before,
					buffer_after: settings.buffer_after,
					minimum_notice: settings.minimum_notice
				}
			: {})
	};
}

export function toPublicAppointment(
	row: Appointment,
	isAdmin: boolean,
	notifications?: ChannelNotification[]
): PublicAppointment {
	const action_log = parseActionLog(row.action_log);

	if (isAdmin) {
		return {
			id: row.id,
			start_time: row.start_time,
			end_time: row.end_time,
			attendee_name: row.attendee_name,
			attendee_email: row.attendee_email,
			answers: parseAttendeeAnswers(row.attendee_answers),
			location: row.location,
			status: row.status,
			action_log,
			notifications,
			email_notification_status: row.email_notification_status,
			calendar_push_notification_status: row.calendar_push_notification_status
		};
	}

	const isConfirmed = row.status === 'confirmed';

	const publicLog = action_log
		.filter((e) => e.action === 'cancel')
		.map((e) => ({
			action: e.action,
			at: e.at,
			payload: e.payload?.note ? { note: e.payload.note } : undefined
		})) as ActionLogEntry[];

	return {
		id: row.id,
		start_time: row.start_time,
		end_time: row.end_time,
		attendee_name: row.attendee_name,
		attendee_email: row.attendee_email,
		answers: parseAttendeeAnswers(row.attendee_answers),
		// Only confirmed appointments can see the location
		location: isConfirmed ? row.location : null,
		status: row.status,
		action_log: publicLog,
		notifications,
		email_notification_status: null,
		calendar_push_notification_status: null
	};
}
