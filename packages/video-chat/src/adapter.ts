import type { VideoChat, Service } from '@when/config';
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
	new (vc: VideoChat, service: Service): VideoChatAdapter;
}

const ADAPTERS: VideoChatAdapterClass[] = [NextcloudTalkAdapter, GoogleMeetAdapter];

function getVideoChatAdapter(vc: VideoChat, services?: Service[]): VideoChatAdapter {
	const AdapterClass = ADAPTERS.find((a) => a.type === vc.type);
	if (!AdapterClass) {
		throw new Error('Unsupported video chat type: ' + vc.type);
	}

	const service = (services ?? []).find((s) => s.id === vc.service_id);
	if (!service) {
		throw new Error('Service "' + vc.service_id + '" not found');
	}
	if (service.type !== AdapterClass.expectedServiceType) {
		throw new Error(
			'Service "' +
				vc.service_id +
				'" is of type "' +
				service.type +
				'", expected "' +
				AdapterClass.expectedServiceType +
				'"'
		);
	}

	return new AdapterClass(vc, service);
}

export type { CreateRoomResult, VideoChatResult, VideoChatDeleteResult, VideoChatAdapter };

export { getVideoChatAdapter };
