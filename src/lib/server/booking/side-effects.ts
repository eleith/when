import { mergeNotificationStatus, type NotificationStatus } from '../db/notification-status';

export type SideEffectKey = keyof NotificationStatus;

export interface NotificationTracker {
	/**
	 * Run a labeled side effect. If the result is not `{ ok: true }`, record the
	 * label as `'failed'` in the tracked notification_status. Returns the result
	 * unchanged so callers can read other fields.
	 */
	run<T extends { ok: boolean }>(key: SideEffectKey, fn: () => Promise<T>): Promise<T>;
	/** Current notification_status (initial + any failures merged in). */
	status(): string | null;
	/** True iff status() differs from the initial value. */
	changed(): boolean;
}

/**
 * Tracks failed side effects and accumulates a notification_status string.
 * Pure in-memory — caller decides when to persist via an UPDATE.
 */
export function createNotificationTracker(initial: string | null): NotificationTracker {
	let current = initial;
	return {
		async run(key, fn) {
			const result = await fn();
			if (!result.ok) current = mergeNotificationStatus(current, { [key]: 'failed' });
			return result;
		},
		status: () => current,
		changed: () => current !== initial
	};
}
