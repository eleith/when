import type { NextcloudProvider, Provider } from '@when/config';
import type { VideoChatAdapter } from './adapter.js';
import { GoogleMeetAdapter, type GoogleEventPort } from './adapters/google-meet.js';
import { NextcloudTalkAdapter } from './adapters/nextcloud-talk.js';

export function getVideoChatAdapter(
	service: Provider,
	bookingEvent: GoogleEventPort | null = null,
	signal?: AbortSignal
): VideoChatAdapter {
	switch (service.type) {
		case 'google':
			if (!bookingEvent) throw new Error('Google Meet requires an already-booked event');
			return new GoogleMeetAdapter(bookingEvent);
		case 'nextcloud':
			return new NextcloudTalkAdapter(service, signal);
		case 'caldav':
			throw new Error('CalDAV does not support video chat');
	}
}

export function isCalendarIntegratedVideoChat(provider: Provider): boolean {
	return provider.type === 'google';
}

export function isStandaloneVideoChat(provider: Provider): provider is NextcloudProvider {
	return provider.type === 'nextcloud';
}
