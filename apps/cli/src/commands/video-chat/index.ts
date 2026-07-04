import { define } from 'gunshi';
import { addCommand } from './add/index.ts';

export const videoChatCommand = define({
	name: 'video-chat',
	description: 'Manage video chat integrations',
	subCommands: {
		add: addCommand
	},
	run() {
		console.log('Use "when-cli video-chat add"');
	}
});
