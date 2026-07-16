import { define } from 'gunshi';
import { text, select, isCancel, spinner } from '@clack/prompts';
import { AppearanceSchema, ConfigEditor } from '@when/config';
import { getValidatedConfigPath, validateConfigExists } from '../../utils/config-path.ts';
import { schemaDefault } from '../../utils/schema-defaults.ts';

// Mirror of web's bundled families ($lib/server/fonts.ts).
const BUNDLED_FONTS = ['Noto Sans', 'Lato', 'Outfit', 'Inter'];
const CUSTOM_FONT = '__custom__';

async function promptTitle(current?: string): Promise<string | null> {
	const fallback = current ?? schemaDefault<string>(AppearanceSchema, 'title');
	const val = await text({
		message: 'What is the booking page title?',
		placeholder: fallback,
		defaultValue: fallback
	});
	return isCancel(val) ? null : val.trim();
}

async function promptDescription(current?: string): Promise<string | null> {
	const fallback = current ?? schemaDefault<string>(AppearanceSchema, 'description');
	const val = await text({
		message: 'What is the booking page description?',
		placeholder: fallback,
		defaultValue: fallback
	});
	return isCancel(val) ? null : val.trim();
}

async function promptPrimaryColor(
	mode: 'light' | 'dark',
	current?: string
): Promise<string | null> {
	const key = mode === 'light' ? 'primary_light_color' : 'primary_dark_color';
	const schemaHex = schemaDefault<string>(AppearanceSchema, key);
	const fallback = current ?? schemaHex;
	const val = await text({
		message: `What is the primary brand color for ${mode} mode (hex)?`,
		placeholder: fallback,
		defaultValue: fallback,
		validate(input) {
			if (input && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(input)) {
				return `Invalid hex color format (e.g. ${schemaHex})`;
			}
		}
	});
	return isCancel(val) ? null : val.trim();
}

async function promptFont(
	currentName?: string,
	currentUrl?: string
): Promise<{ font_name: string; font_url?: string } | null> {
	const bundledMatch = BUNDLED_FONTS.find((f) => f.toLowerCase() === currentName?.toLowerCase());
	const hasCustom = !!currentName && !bundledMatch;

	const choice = await select({
		message: 'Which font family should the booking page use?',
		options: [
			...BUNDLED_FONTS.map((f) => ({ value: f, label: f })),
			{ value: CUSTOM_FONT, label: 'Custom (provide a font name and URL)…' }
		],
		initialValue: hasCustom ? CUSTOM_FONT : (bundledMatch ?? 'Noto Sans')
	});
	if (isCancel(choice)) return null;

	if (choice !== CUSTOM_FONT) {
		return { font_name: choice as string };
	}

	const nameInput = await text({
		message: 'What is the custom font family name?',
		placeholder: currentName ?? 'My Font',
		defaultValue: hasCustom ? currentName : undefined,
		validate(value) {
			if (!value || !value.trim()) return 'Font name is required';
		}
	});
	if (isCancel(nameInput)) return null;

	const urlInput = await text({
		message: 'What is the custom font URL (woff2)? Can be relative (e.g. /public/font.woff2).',
		placeholder: currentUrl ?? 'https://example.com/font.woff2',
		defaultValue: hasCustom ? currentUrl : undefined,
		validate(value) {
			if (!value || !value.trim()) return 'Font URL is required for a custom font';
		}
	});
	if (isCancel(urlInput)) return null;

	return { font_name: nameInput.trim(), font_url: urlInput.trim() };
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

		const font = await promptFont(current.font_name as string, current.font_url as string);
		if (font == null) return;

		const s = spinner();
		s.start('Saving appearance configuration...');

		try {
			editor.set('user.appearance.title', title);
			editor.set('user.appearance.description', description);
			editor.set('user.appearance.primary_light_color', primaryLight);
			editor.set('user.appearance.primary_dark_color', primaryDark);
			editor.set('user.appearance.font_name', font.font_name);
			if (font.font_url) {
				editor.set('user.appearance.font_url', font.font_url);
			} else {
				editor.delete('user.appearance.font_url');
			}
			s.stop('Successfully saved appearance settings to when.yaml!');
		} catch (err) {
			s.stop('Failed to save!');
			console.error(err);
			process.exitCode = 1;
		}
	}
});
