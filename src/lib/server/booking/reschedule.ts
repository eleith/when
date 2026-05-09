import type { EventType } from '$lib/server/config/schema';
import type { Appointment } from '$lib/server/db';
import { isRescheduleAllowed, isViewable } from './access';

export type RescheduleErrorCode =
	| 'token'
	| 'event_type'
	| 'past_window'
	| 'terminal'
	| 'minimum_notice';

export type RescheduleContext =
	| { kind: 'fresh' }
	| { kind: 'reschedule'; id: string; name: string; email: string }
	| { kind: 'error'; code: RescheduleErrorCode };

export interface ClassifyRescheduleInput {
	rescheduleId: string | null;
	token: string | null;
	existing: Appointment | undefined;
	eventType: Pick<EventType, 'id' | 'minimum_notice'>;
	now: Date;
}

export function classifyReschedule({
	rescheduleId,
	token,
	existing,
	eventType,
	now
}: ClassifyRescheduleInput): RescheduleContext {
	if (!rescheduleId) return { kind: 'fresh' };

	if (!token || !existing || existing.cancel_token !== token) {
		return { kind: 'error', code: 'token' };
	}
	if (existing.event_type_id !== eventType.id) {
		return { kind: 'error', code: 'event_type' };
	}
	if (!isViewable(existing, now)) {
		return { kind: 'error', code: 'past_window' };
	}
	if (existing.status === 'cancelled' || existing.status === 'declined') {
		return { kind: 'error', code: 'terminal' };
	}
	if (!isRescheduleAllowed(existing, now, eventType.minimum_notice ?? 0)) {
		return { kind: 'error', code: 'minimum_notice' };
	}
	return {
		kind: 'reschedule',
		id: existing.id,
		name: existing.attendee_name,
		email: existing.attendee_email
	};
}
