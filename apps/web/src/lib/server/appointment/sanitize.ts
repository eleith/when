import { durationsOf, parseGuestAnswers, type Meeting } from '@when/config';
import { parseActionLog, type ActionLogEntry, type Appointment } from '@when/db';

export interface PublicEventType extends Pick<
	Meeting,
	| 'name'
	| 'slug'
	| 'require_approval'
	| 'description'
	| 'location'
	| 'visibility'
	| 'show_slots'
	| 'padding_before_minutes'
	| 'padding_after_minutes'
	| 'notice_minutes'
> {
	duration_minutes: number; // the default (first) length
	durations: number[]; // all offered lengths, in config order
}

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
		duration_minutes: durationsOf(eventType)[0],
		durations: durationsOf(eventType),
		description: eventType.description,
		visibility: eventType.visibility,
		require_approval: eventType.require_approval,
		location: isAdmin ? eventType.location : undefined,
		show_slots: eventType.show_slots,
		padding_before_minutes: eventType.padding_before_minutes,
		padding_after_minutes: eventType.padding_after_minutes,
		notice_minutes: eventType.notice_minutes
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
