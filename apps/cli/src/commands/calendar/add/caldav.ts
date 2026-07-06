import { existsSync } from 'node:fs';
import { define } from 'gunshi';
import { text, spinner, note, isCancel } from '@clack/prompts';
import { getCalendarAdapter } from '@when/calendar';
import { ConfigEditor } from '@when/config';
import type { CalDavCalendar, WhenConfiguration, Service } from '@when/config';

import { getValidatedConfigPath } from '../../../utils/config-path.ts';
import { getOrCreateCalDavService } from '../../../services/caldav.ts';

export async function verifyCalDavConnection(
	cal: CalDavCalendar,
	config: WhenConfiguration
): Promise<void> {
	const adapter = getCalendarAdapter(cal, config);
	const now = Temporal.Now.instant();
	const window = { start: now, end: now.add({ hours: 1 }) };
	await adapter.fetchBusy(window as unknown as import('@when/calendar').ExpandWindow);
}

function validateConfigExists(configPath: string): boolean {
	if (!existsSync(configPath)) {
		console.error(`FAIL  No configuration file found at: ${configPath}`);
		console.error(
			`      Please specify the path to your config.yaml using --config (e.g., "--config apps/web/config.yaml").`
		);
		process.exitCode = 1;
		return false;
	}
	return true;
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

		let existingCalendarIds: string[] = [];
		try {
			const editor = new ConfigEditor(configPath);
			const calendars = (editor.get('calendars') as { id: string }[]) ?? [];
			existingCalendarIds = calendars.map((c) => c.id);
		} catch {
			// ignore
		}

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

		const tempConfig = {
			services: [
				{
					id: serviceId,
					type: 'caldav',
					url,
					username,
					password: passwordPlain
				}
			],
			calendars: [cal]
		} as unknown as WhenConfiguration;

		const s = spinner();
		s.start('Verifying CalDAV connection...');

		try {
			await verifyCalDavConnection(cal, tempConfig);
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
