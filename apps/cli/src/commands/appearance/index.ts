import { define } from 'gunshi';
import { text, isCancel, spinner } from '@clack/prompts';
import { ConfigEditor } from '@when/config';
import { getValidatedConfigPath, validateConfigExists } from '../../utils/config-path.ts';

async function promptTitle(current?: string): Promise<string | null> {
	const val = await text({
		message: 'What is the booking page title?',
		placeholder: current ?? 'Schedule a time with me',
		defaultValue: current ?? 'Schedule a time with me'
	});
	return isCancel(val) ? null : val.trim();
}

async function promptDescription(current?: string): Promise<string | null> {
	const val = await text({
		message: 'What is the booking page description?',
		placeholder: current ?? 'Welcome to my scheduling page',
		defaultValue: current ?? 'Welcome to my scheduling page'
	});
	return isCancel(val) ? null : val.trim();
}

async function promptPrimaryColor(
	mode: 'light' | 'dark',
	current?: string
): Promise<string | null> {
	const defaultHex = mode === 'light' ? '#166534' : '#34d399';
	const val = await text({
		message: `What is the primary brand color for ${mode} mode (hex)?`,
		placeholder: current ?? defaultHex,
		defaultValue: current ?? defaultHex,
		validate(input) {
			if (input && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(input)) {
				return `Invalid hex color format (e.g. ${defaultHex})`;
			}
		}
	});
	return isCancel(val) ? null : val.trim();
}

async function promptFontName(current?: string): Promise<string | null> {
	const val = await text({
		message:
			'What is the font family name (e.g. Outfit, Inter, Lato)? Leave blank for system default.',
		placeholder: current ?? '',
		defaultValue: current ?? ''
	});
	return isCancel(val) ? null : val.trim();
}

export const appearanceCommand = define({
	name: 'appearance',
	description: 'Configure booking page custom branding and colors',
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

		const editor = new ConfigEditor(configPath);
		const current = (editor.get('user.appearance') as Record<string, unknown>) ?? {};

		const title = await promptTitle(current.title as string);
		if (title == null) return;

		const description = await promptDescription(current.description as string);
		if (description == null) return;

		const primaryLight = await promptPrimaryColor('light', current.primary_light_color as string);
		if (primaryLight == null) return;

		const primaryDark = await promptPrimaryColor('dark', current.primary_dark_color as string);
		if (primaryDark == null) return;

		const fontName = await promptFontName(current.font_name as string);
		if (fontName == null) return;

		const s = spinner();
		s.start('Saving appearance configuration...');

		try {
			editor.set('user.appearance.title', title);
			editor.set('user.appearance.description', description);
			editor.set('user.appearance.primary_light_color', primaryLight);
			editor.set('user.appearance.primary_dark_color', primaryDark);
			editor.set('user.appearance.font_name', fontName || null);
			s.stop('Successfully saved appearance settings to when.yaml!');
		} catch (err) {
			s.stop('Failed to save!');
			console.error(err);
			process.exitCode = 1;
		}
	}
});
