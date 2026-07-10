import { parseGuestAnswers, type Meeting } from '@when/config';
import { parseActionLog, type ActionLogEntry, type Appointment } from '@when/db';

type Resolved<T> = { [K in keyof T]-?: NonNullable<T[K]> };

export interface PublicEventType
	extends
		Resolved<
			Pick<
				Meeting,
				| 'visibility'
				| 'booking_style'
				| 'padding_before_minutes'
				| 'padding_after_minutes'
				| 'notice_minutes'
			>
		>,
		Pick<
			Meeting,
			'name' | 'slug' | 'duration_minutes' | 'booking_approval' | 'description' | 'location'
		> {}

export interface PublicAppointment {
	id: string;
	start_time: string;
	end_time: string;
	guest_name: string;
	guest_email: string | null;
	answers: ReturnType<typeof parseGuestAnswers>;
	location: string | null;
	note: string | null;
	video_chat: string | null;
	status: string;
	action_log: ActionLogEntry[];
}

export function toPublicEventType(eventType: Meeting, isAdmin: boolean): PublicEventType {
	return {
		name: eventType.name,
		slug: eventType.slug,
		duration_minutes: eventType.duration_minutes,
		description: eventType.description,
		visibility: eventType.visibility ?? 'public',
		booking_approval: eventType.booking_approval,
		location: isAdmin ? eventType.location : undefined,
		booking_style: eventType.booking_style ?? 'insert',
		padding_before_minutes: eventType.padding_before_minutes ?? 0,
		padding_after_minutes: eventType.padding_after_minutes ?? 0,
		notice_minutes: eventType.notice_minutes ?? 120
	};
}

export function toPublicAppointment(row: Appointment, isAdmin: boolean): PublicAppointment {
	const action_log = parseActionLog(row.action_log);

	if (isAdmin) {
		return {
			id: row.id,
			start_time: row.start_time,
			end_time: row.end_time,
			guest_name: row.guest_name,
			guest_email: row.guest_email,
			answers: parseGuestAnswers(row.guest_answers),
			location: row.location,
			note: row.note,
			video_chat: row.video_chat,
			status: row.status,
			action_log
		};
	}

	const isConfirmed = row.status === 'confirmed';

	const publicLog = action_log
		.filter((e) => e.action === 'cancel' || e.action === 'reschedule')
		.map((e) => ({
			action: e.action,
			actor: e.actor,
			at: e.at,
			payload: {
				note: e.payload?.note || undefined,
				metadata: e.payload?.metadata || undefined
			}
		})) as ActionLogEntry[];

	return {
		id: row.id,
		start_time: row.start_time,
		end_time: row.end_time,
		guest_name: row.guest_name,
		guest_email: row.guest_email,
		answers: parseGuestAnswers(row.guest_answers),
		location: isConfirmed ? row.location : null,
		note: isConfirmed ? row.note : null,
		video_chat: isConfirmed ? row.video_chat : null,
		status: row.status,
		action_log: publicLog
	};
}
