import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { text, select, multiselect } from '@clack/prompts';
import { AppearanceSchema, ConfigEditor } from '@when/config';
import { appearanceCommand, APPEARANCE_FIELD_GROUPS } from './index.ts';

vi.mock('@clack/prompts', () => {
	return {
		text: vi.fn(),
		select: vi.fn(),
		multiselect: vi.fn(),
		isCancel: vi.fn().mockReturnValue(false),
		spinner: vi.fn().mockReturnValue({
			start: vi.fn(),
			message: vi.fn(),
			stop: vi.fn()
		})
	};
});

describe('appearance CLI command', () => {
	const tempConfigPath = join(process.cwd(), 'temp-appearance-config.yaml');

	beforeEach(() => {
		vi.restoreAllMocks();
		if (existsSync(tempConfigPath)) {
			unlinkSync(tempConfigPath);
		}
	});

	afterEach(() => {
		try {
			unlinkSync(tempConfigPath);
		} catch {
			/* ignore */
		}
	});

	const ctx = {
		values: { config: tempConfigPath },
		positionals: [],
		commandPath: []
	} as unknown as Parameters<typeof appearanceCommand.run>[0];

	test('every appearance field is covered by exactly one group (drift guard)', () => {
		const handled = Object.values(APPEARANCE_FIELD_GROUPS).flat();
		expect([...handled].sort()).toEqual(Object.keys(AppearanceSchema.properties).sort());
	});

	test('configuring all groups writes every field, defaulting to the schema', async () => {
		writeFileSync(tempConfigPath, 'user:\n  name: "Jane Doe"\n');

		vi.mocked(multiselect).mockResolvedValueOnce(['text', 'colors', 'assets', 'font']);
		vi.mocked(text)
			.mockResolvedValueOnce('My Scheduling Page') // title
			.mockResolvedValueOnce('Description of booking page') // description
			.mockResolvedValueOnce('#111111') // primary_light
			.mockResolvedValueOnce('#222222') // primary_dark
			.mockResolvedValueOnce('#333333') // background_light
			.mockResolvedValueOnce('#444444') // background_dark
			.mockResolvedValueOnce('#555555') // text_light
			.mockResolvedValueOnce('#666666') // text_dark
			.mockResolvedValueOnce('/public/icon.svg') // app_icon
			.mockResolvedValueOnce('/public/avatar.svg') // avatar
			.mockResolvedValueOnce('/public/favicon.svg') // favicon
			.mockResolvedValueOnce('/public/og.png'); // opengraph
		vi.mocked(select).mockResolvedValueOnce('Outfit'); // bundled font

		await appearanceCommand.run(ctx);

		const editor = new ConfigEditor(tempConfigPath);
		expect(editor.get('user.appearance.title')).toBe('My Scheduling Page');
		expect(editor.get('user.appearance.description')).toBe('Description of booking page');
		expect(editor.get('user.appearance.primary_light_color')).toBe('#111111');
		expect(editor.get('user.appearance.primary_dark_color')).toBe('#222222');
		expect(editor.get('user.appearance.background_light_color')).toBe('#333333');
		expect(editor.get('user.appearance.background_dark_color')).toBe('#444444');
		expect(editor.get('user.appearance.text_light_color')).toBe('#555555');
		expect(editor.get('user.appearance.text_dark_color')).toBe('#666666');
		expect(editor.get('user.appearance.app_icon_url')).toBe('/public/icon.svg');
		expect(editor.get('user.appearance.avatar_url')).toBe('/public/avatar.svg');
		expect(editor.get('user.appearance.favicon_url')).toBe('/public/favicon.svg');
		expect(editor.get('user.appearance.opengraph_url')).toBe('/public/og.png');
		expect(editor.get('user.appearance.font_name')).toBe('Outfit');
		expect(editor.get('user.appearance.font_url')).toBeUndefined();

		// with no existing appearance, prompts default to the schema values
		expect(vi.mocked(text).mock.calls[0][0]).toMatchObject({ defaultValue: 'if not now, when?' });
		expect(vi.mocked(text).mock.calls[2][0]).toMatchObject({ defaultValue: '#166534' });
	});

	test('an unselected group is left untouched', async () => {
		writeFileSync(tempConfigPath, 'user:\n  appearance:\n    title: "Keep Me"\n');

		vi.mocked(multiselect).mockResolvedValueOnce(['colors']);
		vi.mocked(text)
			.mockResolvedValueOnce('#111111')
			.mockResolvedValueOnce('#222222')
			.mockResolvedValueOnce('#333333')
			.mockResolvedValueOnce('#444444')
			.mockResolvedValueOnce('#555555')
			.mockResolvedValueOnce('#666666');

		await appearanceCommand.run(ctx);

		const editor = new ConfigEditor(tempConfigPath);
		expect(editor.get('user.appearance.primary_light_color')).toBe('#111111');
		expect(editor.get('user.appearance.title')).toBe('Keep Me'); // text group not selected
		expect(editor.get('user.appearance.app_icon_url')).toBeUndefined();
		expect(editor.get('user.appearance.font_name')).toBeUndefined();
	});

	test('custom font writes both font_name and font_url', async () => {
		writeFileSync(tempConfigPath, 'user:\n  name: "Jane Doe"\n');

		vi.mocked(multiselect).mockResolvedValueOnce(['font']);
		vi.mocked(select).mockResolvedValueOnce('__custom__');
		vi.mocked(text)
			.mockResolvedValueOnce('My Font') // custom font_name
			.mockResolvedValueOnce('https://example.com/my-font.woff2'); // custom font_url

		await appearanceCommand.run(ctx);

		const editor = new ConfigEditor(tempConfigPath);
		expect(editor.get('user.appearance.font_name')).toBe('My Font');
		expect(editor.get('user.appearance.font_url')).toBe('https://example.com/my-font.woff2');
	});

	test('switching a custom font back to a bundled one clears font_url', async () => {
		writeFileSync(
			tempConfigPath,
			'user:\n  appearance:\n    font_name: "My Font"\n    font_url: "https://example.com/my-font.woff2"\n'
		);

		vi.mocked(multiselect).mockResolvedValueOnce(['font']);
		vi.mocked(select).mockResolvedValueOnce('Inter'); // bundled font

		await appearanceCommand.run(ctx);

		const editor = new ConfigEditor(tempConfigPath);
		expect(editor.get('user.appearance.font_name')).toBe('Inter');
		expect(editor.get('user.appearance.font_url')).toBeUndefined();
	});
});
