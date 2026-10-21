import type {
	VideoChatAdapter,
	VideoChatRequestInput,
	VideoChatResult,
	VideoChatRemoveResult
} from '../adapter.js';

// Bound to an already-booked event by the caller; never checkpoint the port itself.
export interface GoogleEventPort {
	readonly id: string;
	read(): Promise<unknown>;
	// Only a successful PATCH 204 returns undefined; JSON null remains null.
	patch(fields: Record<string, unknown>, query: Record<string, string>): Promise<unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeGoogleConference(data: unknown, eventId: string): VideoChatResult {
	if (!isObject(data) || typeof data.id !== 'string' || !data.id || data.id !== eventId) {
		return { ok: true, status: 'ambiguous' };
	}
	if (data.status === 'cancelled') return { ok: true, status: 'ambiguous' };
	const conference = data.conferenceData;
	if (conference == null) {
		if (data.hangoutLink != null) return { ok: true, status: 'ambiguous' };
		return { ok: true, status: 'absent' };
	}
	if (!isObject(conference)) return { ok: true, status: 'ambiguous' };

	if (conference.createRequest !== undefined) {
		const request = conference.createRequest;
		if (!isObject(request) || !isObject(request.status)) return { ok: true, status: 'ambiguous' };
		// A pending request can still carry entry points from an earlier conference.
		switch (request.status.statusCode) {
			case 'pending':
				return { ok: true, status: 'pending' };
			case 'failure':
				return { ok: true, status: 'failed' };
			case 'success':
				break;
			default:
				return { ok: true, status: 'ambiguous' };
		}
	}

	if (!Array.isArray(conference.entryPoints)) return { ok: true, status: 'ambiguous' };
	const entries: unknown[] = conference.entryPoints;
	const videos = entries.filter(
		(entry): entry is Record<string, unknown> => isObject(entry) && entry.entryPointType === 'video'
	);
	if (videos.length !== 1 || typeof videos[0].uri !== 'string')
		return { ok: true, status: 'ambiguous' };
	const uri = videos[0].uri;
	if (/[\s\p{Cc}]/u.test(uri)) return { ok: true, status: 'ambiguous' };
	try {
		const url = new URL(uri);
		if (url.protocol === 'https:' || url.protocol === 'http:') {
			return { ok: true, status: 'ready', url: uri };
		}
	} catch {
		// Malformed provider data is not evidence that a conference is absent.
	}
	return { ok: true, status: 'ambiguous' };
}

export class GoogleMeetAdapter implements VideoChatAdapter {
	private readonly event: GoogleEventPort;

	constructor(event: GoogleEventPort) {
		this.event = event;
	}

	async read(_knownUrl: string | null): Promise<VideoChatResult> {
		try {
			const data = await this.event.read();
			return decodeGoogleConference(data, this.event.id);
		} catch {
			return { ok: false, reason: 'Google Meet event read failed' };
		}
	}

	async request({ requestId }: VideoChatRequestInput): Promise<VideoChatResult> {
		try {
			const data = await this.event.patch(
				{
					conferenceData: {
						createRequest: {
							requestId,
							conferenceSolutionKey: { type: 'hangoutsMeet' }
						}
					}
				},
				{ conferenceDataVersion: '1', sendUpdates: 'none' }
			);
			return decodeGoogleConference(data, this.event.id);
		} catch {
			return { ok: false, reason: 'Google Meet conference request failed' };
		}
	}

	// Caller authorizes detaching the current conference, including a pending request.
	// This never deletes the booking event or revokes access to the Meet room.
	async removeLink(_knownUrl: string | null): Promise<VideoChatRemoveResult> {
		try {
			const data = await this.event.patch(
				{ conferenceData: null },
				{ conferenceDataVersion: '1', sendUpdates: 'none' }
			);
			if (data === undefined) return { ok: true }; // PATCH 204
			const result = decodeGoogleConference(data, this.event.id);
			if (result.ok && result.status === 'absent') return { ok: true };
			return { ok: false, reason: 'Google Meet conference removal not confirmed' };
		} catch {
			return { ok: false, reason: 'Google Meet conference removal failed' };
		}
	}
}
