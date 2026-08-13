export {
	getVideoChatAdapter,
	isCalendarIntegratedVideoChat,
	isStandaloneVideoChat
} from './adapter.js';
export type {
	VideoChatAdapter,
	VideoChatResult,
	VideoChatDeleteResult,
	CreateRoomResult
} from './adapter.js';
export { NextcloudTalkAdapter } from './adapters/nextcloud-talk.js';
export { GoogleMeetAdapter } from './adapters/google-meet.js';
