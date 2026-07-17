import { text, select, password, isCancel } from '@clack/prompts';
import { ConfigEditor } from '@when/config';
import type { Service } from '@when/config';

export async function getOrCreateCalDavService(
	configPath: string,
	baseId: string
): Promise<{
	serviceId: string;
	baseUrl: string;
	username: string;
	passwordPlain: string;
	isNew: boolean;
	envVarName: string;
	passwordMissing: boolean;
} | null> {
	let services: Service[] = [];
	try {
		const editor = new ConfigEditor(configPath);
		services = (editor.get('services') as Service[]) ?? [];
	} catch {
		// ignore
	}

	const davServices = services.filter((s) => s.type === 'caldav');
	let serviceId = '';
	let isNew = false;
	let baseUrl = '';
	let username = '';
	let passwordPlain = '';
	let envVarName = '';
	let passwordMissing = false;

	if (davServices.length > 0) {
		const choice = await select({
			message: 'Select a CalDAV service or create a new one:',
			options: [
				...davServices.map((s) => ({ value: s.name, label: `${s.name} (${s.username}@${s.url})` })),
				{ value: 'new', label: 'Create new CalDAV service configuration' }
			]
		});
		if (isCancel(choice)) return null;

		if (choice !== 'new') {
			serviceId = choice as string;
			const existing = davServices.find((s) => s.name === serviceId)!;
			baseUrl = existing.url;
			username = existing.username;
			const rawPass = existing.password || '';
			const match = rawPass.match(/\$\{([^}]+)\}/);
			if (match) {
				envVarName = match[1];
				passwordPlain = process.env[match[1]] || '';
				passwordMissing = passwordPlain === '';
			} else {
				passwordPlain = rawPass;
			}
		}
	}

	if (!serviceId) {
		isNew = true;
		serviceId = `${baseId}-service`;

		const urlInput = await text({
			message: 'Enter your CalDAV service base URL:',
			placeholder: 'https://cloud.example.com/remote.php/dav/',
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
		baseUrl = urlInput.trim();

		const usernameInput = await text({
			message: 'Enter your CalDAV username:',
			validate(value) {
				if (!value || !value.trim()) return 'Username is required';
			}
		});
		if (isCancel(usernameInput)) return null;
		username = usernameInput.trim();

		const passwordInput = await password({
			message: 'Enter your CalDAV password (or app password):',
			validate(value) {
				if (!value || !value.trim()) return 'Password is required';
			}
		});
		if (isCancel(passwordInput)) return null;
		passwordPlain = passwordInput;
		envVarName = `WHEN_SERVICE_CALDAV_${baseId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PASSWORD`;
	}

	return { serviceId, baseUrl, username, passwordPlain, isNew, envVarName, passwordMissing };
}

export interface CalDavProbeResult {
	ok: boolean;
	reason?: string;
}

export async function probeCalDavAuth(
	url: string,
	username: string,
	password: string
): Promise<CalDavProbeResult> {
	const body =
		'<?xml version="1.0" encoding="utf-8"?>' +
		'<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
	try {
		const res = await fetch(url, {
			method: 'PROPFIND',
			headers: {
				Authorization: `Basic ${btoa(`${username}:${password}`)}`,
				Depth: '0',
				'Content-Type': 'application/xml; charset=utf-8'
			},
			body
		});
		if (res.status === 401) return { ok: false, reason: 'bad credentials (401)' };
		if (res.ok) return { ok: true };
		return { ok: false, reason: `${res.status} ${res.statusText}` };
	} catch (err) {
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
}
