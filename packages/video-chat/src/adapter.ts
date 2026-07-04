import type { WhenConfiguration, VideoChat, NextcloudService } from '@when/config';

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CreateRoomResult {
	ok: true;
	url: string;
}

export type VideoChatResult = CreateRoomResult | { ok: false; reason: string };

export interface VideoChatAdapter {
	createRoom(roomName: string, opts?: { fetchImpl?: FetchFn }): Promise<VideoChatResult>;
}

import { NextcloudTalkAdapter } from './adapters/nextcloud-talk.js';

export function getVideoChatAdapter(vc: VideoChat, config: WhenConfiguration): VideoChatAdapter {
	if (vc.type === 'nextcloud-talk') {
		const service = (config.services ?? []).find((s) => s.id === vc.service_id);
		if (!service || service.type !== 'nextcloud') {
			throw new Error(`Service "${vc.service_id}" not found or is not of type "nextcloud"`);
		}
		return new NextcloudTalkAdapter(vc, service as NextcloudService);
	}
	if (vc.type === 'google-meet') {
		return {
			async createRoom() {
				return { ok: false, reason: 'Google Meet is managed natively via Google Calendar' };
			}
		};
	}
	throw new Error(`Unsupported video chat type: ${(vc as { type: string }).type}`);
}
