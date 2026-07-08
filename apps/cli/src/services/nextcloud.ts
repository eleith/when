import { text, select, password, isCancel } from '@clack/prompts';
import { ConfigEditor } from '@when/config';
import type { Service } from '@when/config';

export async function getOrCreateNextcloudService(
	configPath: string,
	baseId: string
): Promise<{
	serviceId: string;
	url: string;
	username: string;
	passwordPlain: string;
	isNew: boolean;
	envVarName: string;
} | null> {
	let services: Service[] = [];
	try {
		const editor = new ConfigEditor(configPath);
		services = (editor.get('services') as Service[]) ?? [];
	} catch {
		// ignore
	}

	const ncServices = services.filter((s) => s.type === 'nextcloud');
	let serviceId = '';
	let isNew = false;
	let url = '';
	let username = '';
	let passwordPlain = '';
	let envVarName = '';

	if (ncServices.length > 0) {
		const choice = await select({
			message: 'Select a Nextcloud service or create a new one:',
			options: [
				...ncServices.map((s) => ({ value: s.name, label: `${s.name} (${s.url})` })),
				{ value: 'new', label: 'Create new Nextcloud service configuration' }
			]
		});
		if (isCancel(choice)) return null;

		if (choice !== 'new') {
			serviceId = choice as string;
			const existing = ncServices.find((s) => s.name === serviceId)!;
			url = existing.url;
			username = existing.username;
			const rawPass = existing.password || '';
			const match = rawPass.match(/\$\{([^}]+)\}/);
			passwordPlain = match ? process.env[match[1]] || '' : rawPass;
		}
	}

	if (!serviceId) {
		isNew = true;
		serviceId = `${baseId}-service`;

		const urlInput = await text({
			message: 'Enter your Nextcloud instance URL:',
			placeholder: 'https://cloud.example.com',
			validate(value) {
				if (!value || !value.trim()) return 'URL is required';
				try {
					new URL(value);
				} catch {
					return 'Must be a valid URL';
				}
			}
		});
		if (isCancel(urlInput)) return null;
		url = urlInput.trim();

		const usernameInput = await text({
			message: 'Enter your Nextcloud username:',
			validate(value) {
				if (!value || !value.trim()) return 'Username is required';
			}
		});
		if (isCancel(usernameInput)) return null;
		username = usernameInput.trim();

		const passwordInput = await password({
			message: 'Enter your Nextcloud password (or app password):',
			validate(value) {
				if (!value || !value.trim()) return 'Password is required';
			}
		});
		if (isCancel(passwordInput)) return null;
		passwordPlain = passwordInput;
		envVarName = `WHEN_SERVICE_NEXTCLOUD_${baseId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PASSWORD`;
	}

	return { serviceId, url, username, passwordPlain, isNew, envVarName };
}
