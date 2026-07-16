import { define } from 'gunshi';
import { getValidatedConfigPath, validateConfigExists } from '../../../utils/config-path.ts';
import { getOrCreateNextcloudService } from '../../../services/nextcloud.ts';
import { getExistingNames } from '../../../utils/config.ts';
import { addDavCalendar, promptCalendarName } from './dav.ts';

export const nextcloudAddCommand = define({
	name: 'nextcloud',
	description: 'Wizard to add Nextcloud calendar integration',
	args: {
		config: {
			type: 'string',
			short: 'c',
			description: 'Path to when.yaml file'
		}
	},
	async run(ctx) {
		const configPath = getValidatedConfigPath(ctx.values.config);
		if (!validateConfigExists(configPath)) return;

		const name = await promptCalendarName(getExistingNames(configPath, 'calendars'));
		if (!name) return;

		const serviceResult = await getOrCreateNextcloudService(configPath, name);
		if (!serviceResult) return;

		await addDavCalendar(configPath, name, 'nextcloud', serviceResult);
	}
});
