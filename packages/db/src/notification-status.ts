export type NotificationOutcome = 'failed' | 'ok';

export interface NotificationStatus {
	email?: NotificationOutcome;
	calendar_push?: NotificationOutcome;
}

export function parseNotificationStatus(raw: string | null): NotificationStatus {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object') return parsed as NotificationStatus;
	} catch {
		// fall through
	}
	return {};
}
