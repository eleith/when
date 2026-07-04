import type { VideoChat, NextcloudService } from '@when/config';
import type { VideoChatAdapter, VideoChatResult, FetchFn } from '../adapter.js';
import { Buffer } from 'node:buffer';

export class NextcloudTalkAdapter implements VideoChatAdapter {
	constructor(
		private readonly vc: VideoChat,
		private readonly service: NextcloudService
	) {}

	async createRoom(roomName: string, opts: { fetchImpl?: FetchFn } = {}): Promise<VideoChatResult> {
		const fetcher = opts.fetchImpl ?? globalThis.fetch;
		
		const baseUrl = this.service.url.replace(/\/$/, '');
		const endpoint = `${baseUrl}/ocs/v2.php/apps/spreed/api/v4/room`;

		const credentials = Buffer.from(`${this.service.username}:${this.service.password}`).toString('base64');

		try {
			const res = await fetcher(endpoint, {
				method: 'POST',
				headers: {
					'OCS-APIRequest': 'true',
					'Accept': 'application/json',
					'Content-Type': 'application/json',
					'Authorization': `Basic ${credentials}`
				},
				body: JSON.stringify({
					roomType: 3, // Public room
					roomName
				})
			});

			if (!res.ok) {
				const bodyText = await res.text();
				return { ok: false, reason: `Nextcloud Talk API returned status ${res.status}: ${bodyText}` };
			}

			const data = (await res.json()) as any;
			const token = data?.ocs?.data?.token;
			if (!token) {
				return { ok: false, reason: `Nextcloud Talk API response missing room token: ${JSON.stringify(data)}` };
			}

			return { ok: true, url: `${baseUrl}/call/${token}` };
		} catch (err) {
			return { ok: false, reason: err instanceof Error ? err.message : String(err) };
		}
	}
}
