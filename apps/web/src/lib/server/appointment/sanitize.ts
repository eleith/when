import { parseGuestAnswers, type EventType, type Location } from '@when/config';
import { parseActionLog, type ActionLogEntry, type Appointment } from '@when/db';

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
	guest_name: string;
	guest_email: string | null;
	answers: ReturnType<typeof parseGuestAnswers>;
	location: string | null;
	status: string;
	action_log: ActionLogEntry[];
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
		// Only confirmed appointments can see the location
		location: isConfirmed ? row.location : null,
		status: row.status,
		action_log: publicLog
	};
}
