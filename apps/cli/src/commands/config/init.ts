import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { define } from 'gunshi';
import { select, note, isCancel } from '@clack/prompts';
import { ConfigEditor, ConfigError, loadConfigFileStructure } from '@when/config';
import { getValidatedConfigPath } from '../../utils/config-path.ts';
import { promptAuth } from '../../prompts/auth.ts';
import { promptUser } from '../../prompts/user.ts';
import { promptSmtp } from '../../prompts/smtp.ts';
import { caldavAddCommand } from '../calendars/add/caldav.ts';
import { nextcloudAddCommand } from '../calendars/add/nextcloud.ts';
import { googleAddCommand } from '../calendars/add/google.ts';
import { schedulesAddCommand } from '../schedules/add.ts';
import { meetingsAddCommand } from '../meetings/add.ts';

type SubCommandCtx = Parameters<NonNullable<typeof caldavAddCommand.run>>[0];

export const initCommand = define({
	name: 'init',
	description: 'Create a starter when.yaml by walking through each section',
	args: {
		config: {
			type: 'string',
			short: 'c',
			description: 'Path to write when.yaml (defaults to the standard config location)'
		}
	},
	async run(ctx) {
		const path = getValidatedConfigPath(ctx.values.config);
		if (existsSync(path)) {
			console.error(
				`FAIL  ${path} already exists. Move or remove it first, or pass a different --config path.`
			);
			process.exitCode = 1;
			return;
		}

		const auth = await promptAuth();
		if (!auth) return;
		const user = await promptUser();
		if (!user) return;
		const smtp = await promptSmtp();
		if (!smtp) return;

		mkdirSync(dirname(path), { recursive: true });
		const editor = new ConfigEditor(path);
		editor.set('auth', auth.value);
		editor.set('user', user.value);
		editor.set('smtp', smtp.value);

		const subCtx = {
			values: { config: path },
			positionals: [],
			commandPath: []
		} as unknown as SubCommandCtx;

		const calType = await select({
			message: 'Add your first calendar. Which type?',
			options: [
				{ value: 'caldav', label: 'CalDAV' },
				{ value: 'nextcloud', label: 'Nextcloud' },
				{ value: 'google', label: 'Google' }
			],
			initialValue: 'caldav'
		});
		if (isCancel(calType)) return;
		if (calType === 'caldav') await caldavAddCommand.run!(subCtx);
		else if (calType === 'nextcloud') await nextcloudAddCommand.run!(subCtx);
		else await googleAddCommand.run!(subCtx);

		await schedulesAddCommand.run!(subCtx);
		await meetingsAddCommand.run!(subCtx);

		try {
			await loadConfigFileStructure(path);
		} catch (err) {
			if (err instanceof ConfigError) {
				note(
					`Wrote ${path}, but it isn't complete yet:\n` +
						err.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n') +
						`\n\nFinish the missing sections by hand or re-run the add commands, then run:\n  when-cli config validate`,
					'Almost there'
				);
			} else {
				console.error(err);
			}
			process.exitCode = 1;
			return;
		}

		const envVars = [...auth.envVars, ...smtp.envVars];
		const parts = [`Wrote ${path}.`];
		if (envVars.length) {
			parts.push(
				`Set these environment variables before starting:\n${envVars.map((v) => `  ${v}`).join('\n')}`
			);
		}
		parts.push('Any calendar service password was shown during that step.');
		parts.push('Re-check anytime with:\n  when-cli config validate');
		note(parts.join('\n\n'), 'Setup complete');
	}
});
