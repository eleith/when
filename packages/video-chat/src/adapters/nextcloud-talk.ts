import type { NextcloudService } from '@when/config';
import type { VideoChatAdapter, VideoChatResult, VideoChatDeleteResult } from '../adapter.js';
import { Buffer } from 'node:buffer';

export class NextcloudTalkAdapter implements VideoChatAdapter {
	static readonly type = 'nextcloud-talk';
	static readonly expectedServiceType = 'nextcloud';

	private readonly service: NextcloudService;

	constructor(service: NextcloudService) {
		this.service = service;
	}

	async createRoom(roomName: string): Promise<VideoChatResult> {
		const baseUrl = this.service.url.replace(/\/$/, '');
		const endpoint = `${baseUrl}/ocs/v2.php/apps/spreed/api/v4/room`;

		const credentials = Buffer.from(`${this.service.username}:${this.service.password}`).toString(
			'base64'
		);

		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'OCS-APIRequest': 'true',
					Accept: 'application/json',
					'Content-Type': 'application/json',
					Authorization: `Basic ${credentials}`
				},
				body: JSON.stringify({
					roomType: 3, // Public room
					roomName
				})
			});

			if (!res.ok) {
				const bodyText = await res.text();
				return {
					ok: false,
					reason: `Nextcloud Talk API returned status ${res.status}: ${bodyText}`
				};
			}

			const data = (await res.json()) as { ocs?: { data?: { token?: string } } };
			const token = data?.ocs?.data?.token;
			if (!token) {
				return {
					ok: false,
					reason: `Nextcloud Talk API response missing room token: ${JSON.stringify(data)}`
				};
			}

			return { ok: true, url: `${baseUrl}/call/${token}` };
		} catch (err) {
			return { ok: false, reason: err instanceof Error ? err.message : String(err) };
		}
	}

	async deleteRoom(roomUrl: string): Promise<VideoChatDeleteResult> {
		const baseUrl = this.service.url.replace(/\/$/, '');
		const match = roomUrl.match(/\/call\/([^/]+)$/);
		if (!match) {
			return { ok: false, reason: `Invalid room URL format: ${roomUrl}` };
		}
		const token = match[1];
		const endpoint = `${baseUrl}/ocs/v2.php/apps/spreed/api/v4/room/${token}`;

		const credentials = Buffer.from(`${this.service.username}:${this.service.password}`).toString(
			'base64'
		);

		try {
			const res = await fetch(endpoint, {
				method: 'DELETE',
				headers: {
					'OCS-APIRequest': 'true',
					Accept: 'application/json',
					'Content-Type': 'application/json',
					Authorization: `Basic ${credentials}`
				}
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
