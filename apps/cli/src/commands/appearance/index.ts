import { define } from 'gunshi';
import { text, select, multiselect, isCancel, spinner } from '@clack/prompts';
import { AppearanceSchema, ConfigEditor } from '@when/config';
import { getValidatedConfigPath, validateConfigExists } from '../../utils/config-path.ts';
import { schemaDefault } from '../../utils/schema-defaults.ts';

// Mirror of web's bundled families ($lib/server/fonts.ts).
const BUNDLED_FONTS = ['Noto Sans', 'Lato', 'Outfit', 'Inter'];
const CUSTOM_FONT = '__custom__';

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const TEXT_FIELDS: [string, string][] = [
	['title', 'What is the booking page title?'],
	['description', 'What is the booking page description?']
];

const COLOR_FIELDS: [string, string][] = [
	['primary_light_color', 'Primary color, light mode'],
	['primary_dark_color', 'Primary color, dark mode'],
	['background_light_color', 'Background color, light mode'],
	['background_dark_color', 'Background color, dark mode'],
	['text_light_color', 'Text color, light mode'],
	['text_dark_color', 'Text color, dark mode']
];

const ASSET_FIELDS: [string, string][] = [
	['app_icon_url', 'App icon URL'],
	['avatar_url', 'Avatar image URL'],
	['favicon_url', 'Favicon URL'],
	['opengraph_url', 'Share (OpenGraph) image URL']
];

// Every appearance field, grouped for the wizard's section picker. The drift
// test asserts this covers AppearanceSchema.properties exactly, so a new schema
// field fails CLI tests until the wizard learns it.
export const APPEARANCE_FIELD_GROUPS = {
	text: TEXT_FIELDS.map(([key]) => key),
	colors: COLOR_FIELDS.map(([key]) => key),
	assets: ASSET_FIELDS.map(([key]) => key),
	font: ['font_name', 'font_url']
};

type Current = Record<string, unknown>;

async function promptString(
	key: string,
	message: string,
	current: Current
): Promise<string | null> {
	const fallback = (current[key] as string) ?? schemaDefault<string>(AppearanceSchema, key);
	const val = await text({ message, placeholder: fallback, defaultValue: fallback });
	return isCancel(val) ? null : val.trim();
}

async function promptColor(key: string, label: string, current: Current): Promise<string | null> {
	const schemaHex = schemaDefault<string>(AppearanceSchema, key);
	const fallback = (current[key] as string) ?? schemaHex;
	const val = await text({
		message: `${label} (hex)?`,
		placeholder: fallback,
		defaultValue: fallback,
		validate(input) {
			if (input && !HEX.test(input)) return `Invalid hex color format (e.g. ${schemaHex})`;
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
		const current = (editor.get('user.appearance') as Current) ?? {};

		const groups = await multiselect({
			message: 'Which appearance groups do you want to configure?',
			options: [
				{ value: 'text', label: 'Text (title, description)' },
				{ value: 'colors', label: 'Colors (primary, background, text)' },
				{ value: 'assets', label: 'Assets (app icon, avatar, favicon, share image)' },
				{ value: 'font', label: 'Font' }
			],
			initialValues: ['text', 'colors', 'assets', 'font'],
			required: false
		});
		if (isCancel(groups)) return;
		const selected = groups as string[];

		const stringWrites: Record<string, string> = {};

		if (selected.includes('text')) {
			for (const [key, message] of TEXT_FIELDS) {
				const val = await promptString(key, message, current);
				if (val == null) return;
				stringWrites[key] = val;
			}
		}

		if (selected.includes('colors')) {
			for (const [key, label] of COLOR_FIELDS) {
				const val = await promptColor(key, label, current);
				if (val == null) return;
				stringWrites[key] = val;
			}
		}

		if (selected.includes('assets')) {
			for (const [key, label] of ASSET_FIELDS) {
				const val = await promptString(key, `${label}?`, current);
				if (val == null) return;
				stringWrites[key] = val;
			}
		}

		let font: { font_name: string; font_url?: string } | null = null;
		if (selected.includes('font')) {
			font = await promptFont(current.font_name as string, current.font_url as string);
			if (font == null) return;
		}

		const s = spinner();
		s.start('Saving appearance configuration...');

		try {
			for (const [key, val] of Object.entries(stringWrites)) {
				editor.set(`user.appearance.${key}`, val);
			}
			if (font) {
				editor.set('user.appearance.font_name', font.font_name);
				if (font.font_url) {
					editor.set('user.appearance.font_url', font.font_url);
				} else {
					editor.delete('user.appearance.font_url');
				}
			}
			s.stop('Successfully saved appearance settings to when.yaml!');
		} catch (err) {
			s.stop('Failed to save!');
			console.error(err);
			process.exitCode = 1;
		}
	}
});
