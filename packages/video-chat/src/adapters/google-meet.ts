import type { GoogleProvider } from '@when/config';
import type { VideoChatAdapter, VideoChatResult, VideoChatDeleteResult } from '../adapter.js';

export class GoogleMeetAdapter implements VideoChatAdapter {
	static readonly type = 'google-meet';
	static readonly expectedProviderType = 'google';

	private readonly _service: GoogleProvider;

	constructor(_service: GoogleProvider) {
		this._service = _service;
	}

	async createRoom(): Promise<VideoChatResult> {
		return { ok: false, reason: 'Google Meet is managed natively via Google Calendar' };
	}

	async deleteRoom(): Promise<VideoChatDeleteResult> {
		// Google Meet is cleaned up when Google Calendar event is deleted
		return { ok: true };
	}
}
