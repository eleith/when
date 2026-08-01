import type { Provider } from '@when/config';
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
	readonly expectedProviderType: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	new (provider: any): VideoChatAdapter;
}

const ADAPTERS: VideoChatAdapterClass[] = [NextcloudTalkAdapter, GoogleMeetAdapter];

function getVideoChatAdapter(provider: Provider): VideoChatAdapter {
	const AdapterClass = ADAPTERS.find((a) => a.expectedProviderType === provider.type);
	if (!AdapterClass) {
		throw new Error('Unsupported video chat provider type: ' + provider.type);
	}
	return new AdapterClass(provider);
}

export type { CreateRoomResult, VideoChatResult, VideoChatDeleteResult, VideoChatAdapter };

export { getVideoChatAdapter };
