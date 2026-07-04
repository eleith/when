import { define } from 'gunshi';
import { googleMeetAddCommand } from './google.ts';
import { nextcloudTalkAddCommand } from './nextcloud.ts';

export const addCommand = define({
	name: 'add',
	description: 'Add video chat integrations',
	subCommands: {
		'google-meet': googleMeetAddCommand,
		'nextcloud-talk': nextcloudTalkAddCommand
	},
	run() {
		console.log('Use "when-cli video-chat add google-meet" or "when-cli video-chat add nextcloud-talk"');
	}
});
