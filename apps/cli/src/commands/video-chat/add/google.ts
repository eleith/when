import { define } from 'gunshi';
import { text, spinner, note, isCancel } from '@clack/prompts';
import { ConfigEditor } from '@when/config';
import type { Service, VideoChat } from '@when/config';
import { getValidatedConfigPath, validateConfigExists } from '../../../utils/config-path.ts';
import { getOrCreateGoogleService } from '../../../services/google.ts';
import { getExistingIds } from '../../../utils/config.ts';

async function promptGoogleMeetId(existingIds: string[]): Promise<string | null> {
	const videoChatId = await text({
		message: 'Enter a unique ID for this Google Meet integration (e.g. "my-meet"):',
		placeholder: 'my-meet',
		validate(value) {
			if (!value || !value.trim()) return 'ID is required';
			if (existingIds.includes(value.trim())) {
				return `A video chat with ID "${value.trim()}" already exists.`;
			}
		}
	});
	if (isCancel(videoChatId)) return null;
	return videoChatId.trim();
}

async function verifyGoogleMeetAccess(
	clientId: string,
	clientSecret: string,
	refreshToken: string
): Promise<void> {
	const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: 'refresh_token'
		})
	});

	if (!tokenResponse.ok) {
		const text = await tokenResponse.text();
		throw new Error(`Google connection verification failed: ${tokenResponse.status} ${text}`);
	}
}

interface WriteGoogleMeetConfigOpts {
	configPath: string;
	id: string;
	serviceId: string;
	clientId: string;
	clientSecret: string;
	refreshToken: string;
	isNew: boolean;
	envClientSecret: string;
	envRefreshToken: string;
}

function writeGoogleMeetConfig({
	configPath,
	id,
	serviceId,
	clientId,
	isNew,
	envClientSecret,
	envRefreshToken
}: WriteGoogleMeetConfigOpts): void {
	const editor = new ConfigEditor(configPath);
	const servicesList = (editor.get('services') as Service[]) ?? [];
	const videoChatsList = (editor.get('video_chats') as VideoChat[]) ?? [];

	if (isNew) {
		const serviceToWrite = {
			id: serviceId,
			type: 'google',
			client_id: clientId,
			client_secret: `\${${envClientSecret}}`,
			refresh_token: `\${${envRefreshToken}}`
		};
		editor.set(`services.${servicesList.length}`, serviceToWrite);
	}

	editor.set(`video_chats.${videoChatsList.length}`, {
		id,
		type: 'google-meet',
		service_id: serviceId
	});
}

function getCompletionMessage(
	id: string,
	serviceId: string,
	clientSecret: string,
	refreshToken: string,
	isNew: boolean,
	envClientSecret: string,
	envRefreshToken: string
): string {
	let message = `Successfully verified and added video chat "${id}" to config.yaml!\n`;
	if (isNew) {
		message +=
			`\n⚠️  Please define the following environment variables (e.g. in your .env or Docker config):\n\n` +
			`${envClientSecret}="${clientSecret}"\n` +
			`${envRefreshToken}="${refreshToken}"`;
	} else {
		message += `\nReused existing service configuration "${serviceId}".`;
	}
	return message;
}

export const googleMeetAddCommand = define({
	name: 'google-meet',
	description: 'Wizard to add Google Meet integration',
	args: {
		config: {
			type: 'string',
			short: 'c',
			description: 'Path to config.yaml file'
		}
	},
	async run(ctx) {
		const configPathArg = ctx.values.config;
		const configPath = getValidatedConfigPath(configPathArg);

		if (!validateConfigExists(configPath)) {
			return;
		}

		const existingVideoChatIds = getExistingIds(configPath, 'video_chats');
		const id = await promptGoogleMeetId(existingVideoChatIds);
		if (!id) return;

		const serviceResult = await getOrCreateGoogleService(configPath, id);
		if (!serviceResult) return;

		const {
			serviceId,
			clientId,
			clientSecret,
			refreshToken,
			isNew,
			envClientSecret,
			envRefreshToken
		} = serviceResult;

		const s = spinner();
		s.start('Verifying Google API access...');

		try {
			await verifyGoogleMeetAccess(clientId, clientSecret, refreshToken);

			s.message('Writing Google Meet configuration...');

			writeGoogleMeetConfig({
				configPath,
				id,
				serviceId,
				clientId,
				clientSecret,
				refreshToken,
				isNew,
				envClientSecret,
				envRefreshToken
			});

			s.stop('Setup completed successfully!');

			const completionMsg = getCompletionMessage(
				id,
				serviceId,
				clientSecret,
				refreshToken,
				isNew,
				envClientSecret,
				envRefreshToken
			);
			note(completionMsg, 'Setup Complete');
		} catch (err) {
			s.stop('Failed!');
			const message = err instanceof Error ? err.message : String(err);
			note(
				`Error details:\n${message}\n\nPlease check your credentials and try again.`,
				'Verification Failed'
			);
			process.exitCode = 1;
		}
	}
});
