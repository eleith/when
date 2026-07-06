import { existsSync } from 'node:fs';
import { define } from 'gunshi';
import { text, spinner, note, isCancel } from '@clack/prompts';
import { getCalendarAdapter, type ExpandWindow } from '@when/calendar';
import { ConfigEditor, type CalDavCalendar, type WhenConfiguration, type Service } from '@when/config';

import { getValidatedConfigPath, validateConfigExists } from '../../../utils/config-path.ts';
import { getOrCreateCalDavService } from '../../../services/caldav.ts';
import { getExistingIds } from '../../../utils/config.ts';

export async function verifyCalDavConnection(
	cal: CalDavCalendar,
	service: Service
): Promise<void> {
	const adapter = getCalendarAdapter(cal, [service]);
	const now = Temporal.Now.instant();
	const window: ExpandWindow = { start: now, end: now.add({ hours: 1 }) };
	await adapter.fetchBusy(window);
}

export const caldavAddCommand = define({
	name: 'caldav',
	description: 'Wizard to add CalDAV calendar integration',
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

		const existingCalendarIds = getExistingIds(configPath, 'calendars');

		const calendarId = await text({
			message: 'Enter a unique ID for this calendar (e.g., "work"):',
			placeholder: 'work',
			validate(value) {
				if (!value || !value.trim()) return 'Calendar ID is required';
				if (existingCalendarIds.includes(value.trim())) {
					return `A calendar with ID "${value.trim()}" already exists in config.yaml.`;
				}
			}
		});
		if (isCancel(calendarId)) return;
		const id = calendarId.trim();

		const serviceResult = await getOrCreateCalDavService(configPath, id);
		if (!serviceResult) {
			return;
		}

		const { serviceId, url, username, passwordPlain, isNew, envVarName } = serviceResult;

		const cal: CalDavCalendar = {
			id,
			type: 'caldav',
			service_id: serviceId,
			url
		};

		const service: Service = {
			id: serviceId,
			type: 'caldav',
			url,
			username,
			password: passwordPlain
		};

		const s = spinner();
		s.start('Verifying CalDAV connection...');

		try {
			await verifyCalDavConnection(cal, service);
			s.message('Writing calendar and service to configuration...');

			const editor = new ConfigEditor(configPath);
			const services = (editor.get('services') as Service[]) ?? [];
			const calendarsList = (editor.get('calendars') as CalDavCalendar[]) ?? [];

			if (isNew) {
				const serviceToWrite = {
					id: serviceId,
					type: 'caldav',
					url,
					username,
					password: `\${${envVarName}}`
				};
				editor.set(`services.${services.length}`, serviceToWrite);
			}

			editor.set(`calendars.${calendarsList.length}`, cal);
			s.stop('Setup completed successfully!');

			let completionMsg = `Successfully verified and added calendar "${id}" to config.yaml!\n`;
			if (isNew) {
				completionMsg +=
					`\n⚠️  Please define the following environment variable (e.g. in your .env or Docker config):\n\n` +
					`${envVarName}="[your-password-here]"`;
			} else {
				completionMsg += `\nReused existing service configuration "${serviceId}".`;
			}

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
