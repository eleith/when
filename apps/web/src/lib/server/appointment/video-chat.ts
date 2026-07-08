import type { Meeting, WhenConfiguration } from '@when/config';

export function resolveAppointmentVideoChat(
	meeting: Meeting,
	config: WhenConfiguration
): string | null {
	if (!meeting.video_chat_service) {
		return null;
	}
	const service = config.services?.find((s) => s.name === meeting.video_chat_service);
	if (service?.type === 'google') {
		return 'google-meet';
	}
	if (service?.type === 'nextcloud') {
		return 'nextcloud-talk';
	}
	return null;
}
