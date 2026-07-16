import { define } from 'gunshi';
import { text, spinner, note, isCancel } from '@clack/prompts';
import { ConfigEditor, type CalDavCalendar, type Service } from '@when/config';
import { getCalendarAdapter, type ExpandWindow } from '@when/calendar';
import { getValidatedConfigPath, validateConfigExists } from '../../../utils/config-path.ts';
import { getOrCreateCalDavService } from '../../../services/caldav.ts';
import { getExistingNames } from '../../../utils/config.ts';

export async function verifyCalDavConnection(cal: CalDavCalendar, service: Service): Promise<void> {
	const adapter = getCalendarAdapter(cal, [service]);
	const now = Temporal.Now.instant();
	const window: ExpandWindow = { start: now, end: now.add({ hours: 1 }) };
	await adapter.fetchBusy(window);
}

async function promptCalDavCalendarName(existingNames: string[]): Promise<string | null> {
	const calendarName = await text({
		message: 'Enter a unique name for this calendar (e.g., "work"):',
		placeholder: 'work',
		validate(value) {
			if (!value || !value.trim()) return 'Calendar name is required';
			if (existingNames.includes(value.trim())) {
				return `A calendar with name "${value.trim()}" already exists in when.yaml.`;
			}
		}
	});
	if (isCancel(calendarName)) return null;
	return calendarName.trim();
}

async function promptCalendarEndpoint(): Promise<string | null> {
	const endpoint = await text({
		message: "Enter this calendar's path (joined to the service base URL) or a full URL:",
		placeholder: 'calendars/username/work/',
		validate(value) {
			if (!value || !value.trim()) return 'A path or URL is required';
		}
	});
	if (isCancel(endpoint)) return null;
	return endpoint.trim();
}

function buildCalDavCalendar(name: string, serviceId: string, endpoint: string): CalDavCalendar {
	try {
		new URL(endpoint);
		return { name, type: 'caldav', service: serviceId, url: endpoint };
	} catch {
		return { name, type: 'caldav', service: serviceId, path: endpoint };
	}
}

interface WriteCalDavConfigOpts {
	configPath: string;
	cal: CalDavCalendar;
	serviceId: string;
	baseUrl: string;
	username: string;
	envVarName: string;
	isNew: boolean;
}

function writeCalDavConfig({
	configPath,
	cal,
	serviceId,
	baseUrl,
	username,
	envVarName,
	isNew
}: WriteCalDavConfigOpts): void {
	const editor = new ConfigEditor(configPath);
	const services = (editor.get('services') as Service[]) ?? [];
	const calendarsList = (editor.get('calendars') as CalDavCalendar[]) ?? [];

	if (isNew) {
		const serviceToWrite = {
			name: serviceId,
			type: 'caldav',
			url: baseUrl,
			username,
			password: `\${${envVarName}}`
		};
		editor.set(`services.${services.length}`, serviceToWrite);
	}

	editor.set(`calendars.${calendarsList.length}`, cal);
}

function getCompletionMessage(
	id: string,
	serviceId: string,
	envVarName: string,
	isNew: boolean
): string {
	let message = `Successfully verified and added calendar "${id}" to when.yaml!\n`;
	if (isNew) {
		message +=
			`\n⚠️  Please define the following environment variable (e.g. in your .env or Docker config):\n\n` +
			`${envVarName}="[your-password-here]"`;
	} else {
		message += `\nReused existing service configuration "${serviceId}".`;
	}
	return message;
}

export const caldavAddCommand = define({
	name: 'caldav',
	description: 'Wizard to add CalDAV calendar integration',
	args: {
		config: {
			type: 'string',
			short: 'c',
			description: 'Path to when.yaml file'
		}
	},
	async run(ctx) {
		const configPathArg = ctx.values.config;
		const configPath = getValidatedConfigPath(configPathArg);

		if (!validateConfigExists(configPath)) {
			return;
		}

		const existingCalendarNames = getExistingNames(configPath, 'calendars');
		const name = await promptCalDavCalendarName(existingCalendarNames);
		if (!name) return;

		const serviceResult = await getOrCreateCalDavService(configPath, name);
		if (!serviceResult) return;

		const { serviceId, baseUrl, username, passwordPlain, isNew, envVarName, passwordMissing } =
			serviceResult;

		if (passwordMissing) {
			note(
				`The password for service "${serviceId}" comes from ${envVarName}, which is unset in this shell.\n` +
					`Set it and re-run (docker loads it from .env automatically):\n\n` +
					`${envVarName}="[your-password-here]"`,
				'Missing password'
			);
			process.exitCode = 1;
			return;
		}

		const endpoint = await promptCalendarEndpoint();
		if (!endpoint) return;

		const cal = buildCalDavCalendar(name, serviceId, endpoint);

		const service: Service = {
			name: serviceId,
			type: 'caldav',
			url: baseUrl,
			username,
			password: passwordPlain
		};

		const s = spinner();
		s.start('Verifying CalDAV connection...');

		try {
			await verifyCalDavConnection(cal, service);
			s.message('Writing calendar and service to configuration...');

			writeCalDavConfig({
				configPath,
				cal,
				serviceId,
				baseUrl,
				username,
				envVarName,
				isNew
			});

			s.stop('Setup completed successfully!');

			const completionMsg = getCompletionMessage(name, serviceId, envVarName, isNew);
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
