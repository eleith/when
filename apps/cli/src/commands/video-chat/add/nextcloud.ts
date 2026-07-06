import { define } from 'gunshi';
import { text, spinner, note, isCancel } from '@clack/prompts';
import { ConfigEditor } from '@when/config';
import type { Service, VideoChat } from '@when/config';
import { getValidatedConfigPath, validateConfigExists } from '../../../utils/config-path.ts';
import { getOrCreateNextcloudService } from '../../../services/nextcloud.ts';
import { getExistingIds } from '../../../utils/config.ts';
import { getVideoChatAdapter } from '@when/video-chat';

async function promptNextcloudTalkId(existingIds: string[]): Promise<string | null> {
	const videoChatId = await text({
		message: 'Enter a unique ID for this Nextcloud Talk integration (e.g. "my-talk"):',
		placeholder: 'my-talk',
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

async function verifyNextcloudTalkAccess(
	videoChatConfig: { id: string; type: 'nextcloud-talk'; service_id: string },
	service: Service
): Promise<void> {
	const adapter = getVideoChatAdapter(videoChatConfig, [service]);
	const roomResult = await adapter.createRoom('Verification test room');
	if (!roomResult.ok) {
		throw new Error(roomResult.reason);
	}
}

interface WriteNextcloudConfigOpts {
	configPath: string;
	id: string;
	serviceId: string;
	url: string;
	username: string;
	envVarName: string;
	isNew: boolean;
}

function writeNextcloudTalkConfig({
	configPath,
	id,
	serviceId,
	url,
	username,
	envVarName,
	isNew
}: WriteNextcloudConfigOpts): void {
	const editor = new ConfigEditor(configPath);
	const servicesList = (editor.get('services') as Service[]) ?? [];
	const videoChatsList = (editor.get('video_chats') as VideoChat[]) ?? [];

	if (isNew) {
		const serviceToWrite = {
			id: serviceId,
			type: 'nextcloud',
			url,
			username,
			password: `\${${envVarName}}`
		};
		editor.set(`services.${servicesList.length}`, serviceToWrite);
	}

	editor.set(`video_chats.${videoChatsList.length}`, {
		id,
		type: 'nextcloud-talk',
		service_id: serviceId
	});
}

function getCompletionMessage(
	id: string,
	serviceId: string,
	envVarName: string,
	isNew: boolean
): string {
	let message = `Successfully verified and added video chat "${id}" to config.yaml!\n`;
	if (isNew) {
		message +=
			`\n⚠️  Please define the following environment variable:\n\n` +
			`${envVarName}="[your-password-here]"`;
	} else {
		message += `\nReused existing service configuration "${serviceId}".`;
	}
	return message;
}

export const nextcloudTalkAddCommand = define({
	name: 'nextcloud-talk',
	description: 'Wizard to add Nextcloud Talk integration',
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
		const id = await promptNextcloudTalkId(existingVideoChatIds);
		if (!id) return;

		const serviceResult = await getOrCreateNextcloudService(configPath, id);
		if (!serviceResult) return;

		const { serviceId, url, username, passwordPlain, isNew, envVarName } = serviceResult;

		const videoChatConfig = {
			id,
			type: 'nextcloud-talk' as const,
			service_id: serviceId
		};

		const service: Service = {
			id: serviceId,
			type: 'nextcloud' as const,
			url,
			username,
			password: passwordPlain
		};

		const s = spinner();
		s.start('Verifying Nextcloud Talk room creation capabilities...');

		try {
			await verifyNextcloudTalkAccess(videoChatConfig, service);

			s.message('Writing Nextcloud video chat configuration...');

			writeNextcloudTalkConfig({
				configPath,
				id,
				serviceId,
				url,
				username,
				envVarName,
				isNew
			});

			s.stop('Setup completed successfully!');

			const completionMsg = getCompletionMessage(id, serviceId, envVarName, isNew);
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
