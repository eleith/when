import type { Service } from '@when/config';
import { NextcloudTalkAdapter } from './adapters/nextcloud-talk.js';
import { GoogleMeetAdapter } from './adapters/google-meet.js';

interface CreateRoomResult {
	ok: true;
	url: string;
}

type VideoChatResult = CreateRoomResult | { ok: false; reason: string };

type VideoChatDeleteResult = { ok: true } | { ok: false; reason: string };

interface VideoChatAdapter {
	createRoom(roomName: string): Promise<VideoChatResult>;
	deleteRoom(roomUrl: string): Promise<VideoChatDeleteResult>;
}

interface VideoChatAdapterClass {
	readonly type: string;
	readonly expectedServiceType: string;
	new (service: any): VideoChatAdapter;
}

const ADAPTERS: VideoChatAdapterClass[] = [NextcloudTalkAdapter, GoogleMeetAdapter];

function getVideoChatAdapter(service: Service): VideoChatAdapter {
	const AdapterClass = ADAPTERS.find((a) => a.expectedServiceType === service.type);
	if (!AdapterClass) {
		throw new Error('Unsupported video chat service type: ' + service.type);
	}
	return new AdapterClass(service);
}

export type { CreateRoomResult, VideoChatResult, VideoChatDeleteResult, VideoChatAdapter };

export { getVideoChatAdapter };
