import type { NextcloudProvider } from '@when/config';
import type {
	VideoChatAdapter,
	VideoChatRequestInput,
	VideoChatResult,
	VideoChatRemoveResult
} from '../adapter.js';
import { Buffer } from 'node:buffer';

function decodedPath(pathname: string): string[] | null {
	try {
		const segments = pathname.split('/').map((segment) => decodeURIComponent(segment));
		if (segments.some((segment) => /[/\\]/.test(segment))) return null;
		return segments;
	} catch {
		return null;
	}
}

export function nextcloudRoomToken(
	provider: Pick<NextcloudProvider, 'url'>,
	roomUrl: string
): string | null {
	try {
		const base = new URL(provider.url);
		const room = new URL(roomUrl);
		if ((base.protocol !== 'https:' && base.protocol !== 'http:') || base.origin !== room.origin) {
			return null;
		}
		const basePath = decodedPath(base.pathname.replace(/\/$/, ''));
		const roomPath = decodedPath(room.pathname);
		if (!basePath || !roomPath || roomPath.length !== basePath.length + 2) return null;
		if (!basePath.every((segment, index) => segment === roomPath[index])) return null;
		const token = roomPath[roomPath.length - 1];
		if (roomPath[basePath.length] !== 'call' || !/^[a-zA-Z0-9_-]+$/.test(token)) return null;
		return token;
	} catch {
		return null;
	}
}

export class NextcloudTalkAdapter implements VideoChatAdapter {
	private readonly provider: NextcloudProvider;

	constructor(provider: NextcloudProvider) {
		this.provider = provider;
	}

	private requestHeaders(): Record<string, string> {
		const credentials = Buffer.from(`${this.provider.username}:${this.provider.password}`).toString(
			'base64'
		);
		return {
			'OCS-APIRequest': 'true',
			Accept: 'application/json',
			Authorization: `Basic ${credentials}`
		};
	}

	async request({ name }: VideoChatRequestInput): Promise<VideoChatResult> {
		const baseUrl = this.provider.url.replace(/\/$/, '');
		const endpoint = `${baseUrl}/ocs/v2.php/apps/spreed/api/v4/room`;

		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { ...this.requestHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({
					roomType: 3, // Public room
					roomName: name
				})
			});

			if (!res.ok) {
				const bodyText = await res.text();
				return {
					ok: false,
					reason: `Nextcloud Talk API returned status ${res.status}: ${bodyText}`
				};
			}

			const response = await res.json();
			const data = response as { ocs?: { data?: { token?: string } } };
			const token = data?.ocs?.data?.token;
			if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(token)) {
				return {
					ok: false,
					reason: 'Nextcloud Talk API response has no valid room token'
				};
			}

			return { ok: true, status: 'ready', url: `${baseUrl}/call/${token}` };
		} catch (err) {
			return { ok: false, reason: err instanceof Error ? err.message : String(err) };
		}
	}

	async read(knownUrl: string | null): Promise<VideoChatResult> {
		if (knownUrl === null) return { ok: true, status: 'absent' };
		const token = nextcloudRoomToken(this.provider, knownUrl);
		if (!token) return { ok: false, reason: 'Invalid Nextcloud room identity' };
		const baseUrl = this.provider.url.replace(/\/$/, '');
		const endpoint = `${baseUrl}/ocs/v2.php/apps/spreed/api/v4/room/${token}`;
		try {
			const res = await fetch(endpoint, {
				method: 'GET',
				headers: this.requestHeaders()
			});
			// Even 404 means not found for this participant, not known absence.
			if (res.status !== 200) {
				return { ok: false, reason: `Nextcloud Talk room read returned status ${res.status}` };
			}
			const body = await res.text();
			let response: unknown;
			try {
				response = JSON.parse(body);
			} catch {
				return { ok: true, status: 'ambiguous' };
			}
			const data = response as { ocs?: { data?: { token?: unknown } } } | null;
			const observedToken = data?.ocs?.data?.token;
			if (
				typeof observedToken !== 'string' ||
				!/^[a-zA-Z0-9_-]+$/.test(observedToken) ||
				observedToken !== token
			) {
				return { ok: true, status: 'ambiguous' };
			}
			return { ok: true, status: 'ready', url: `${baseUrl}/call/${token}` };
		} catch {
			return { ok: false, reason: 'Nextcloud Talk room read failed' };
		}
	}

	async removeLink(roomUrl: string | null): Promise<VideoChatRemoveResult> {
		if (roomUrl === null) return { ok: true };
		const baseUrl = this.provider.url.replace(/\/$/, '');
		const token = nextcloudRoomToken(this.provider, roomUrl);
		if (!token) {
			return { ok: false, reason: 'Invalid Nextcloud room identity' };
		}
		const endpoint = `${baseUrl}/ocs/v2.php/apps/spreed/api/v4/room/${token}`;

		try {
			const res = await fetch(endpoint, {
				method: 'DELETE',
				headers: { ...this.requestHeaders(), 'Content-Type': 'application/json' }
			});

			if (!res.ok) {
				const bodyText = await res.text();
				return {
					ok: false,
					reason: `Nextcloud Talk API returned status ${res.status}: ${bodyText}`
				};
			}

			return { ok: true };
		} catch (err) {
			return { ok: false, reason: err instanceof Error ? err.message : String(err) };
		}
	}
}
