import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { text, select } from '@clack/prompts';
import { ConfigEditor } from '@when/config';
import { appearanceCommand } from './index.ts';

vi.mock('@clack/prompts', () => {
	return {
		text: vi.fn(),
		select: vi.fn(),
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

	test('saves appearance overrides with a bundled font as a string (never null)', async () => {
		writeFileSync(tempConfigPath, 'user:\n  name: "Jane Doe"\n');

		vi.mocked(text)
			.mockResolvedValueOnce('My Scheduling Page') // title
			.mockResolvedValueOnce('Description of booking page') // description
			.mockResolvedValueOnce('#123456') // primary_light_color
			.mockResolvedValueOnce('#abcdef'); // primary_dark_color
		vi.mocked(select).mockResolvedValueOnce('Outfit'); // bundled font

		await appearanceCommand.run(ctx);

		const editor = new ConfigEditor(tempConfigPath);
		expect(editor.get('user.appearance.title')).toBe('My Scheduling Page');
		expect(editor.get('user.appearance.description')).toBe('Description of booking page');
		expect(editor.get('user.appearance.primary_light_color')).toBe('#123456');
		expect(editor.get('user.appearance.primary_dark_color')).toBe('#abcdef');
		expect(editor.get('user.appearance.font_name')).toBe('Outfit');
		expect(editor.get('user.appearance.font_url')).toBeUndefined();
	});

	test('custom font writes both font_name and font_url', async () => {
		writeFileSync(tempConfigPath, 'user:\n  name: "Jane Doe"\n');

		vi.mocked(text)
			.mockResolvedValueOnce('My Scheduling Page') // title
			.mockResolvedValueOnce('Description of booking page') // description
			.mockResolvedValueOnce('#123456') // primary_light_color
			.mockResolvedValueOnce('#abcdef') // primary_dark_color
			.mockResolvedValueOnce('My Font') // custom font_name
			.mockResolvedValueOnce('https://example.com/my-font.woff2'); // custom font_url
		vi.mocked(select).mockResolvedValueOnce('__custom__'); // custom option

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

		vi.mocked(text)
			.mockResolvedValueOnce('My Scheduling Page') // title
			.mockResolvedValueOnce('Description of booking page') // description
			.mockResolvedValueOnce('#123456') // primary_light_color
			.mockResolvedValueOnce('#abcdef'); // primary_dark_color
		vi.mocked(select).mockResolvedValueOnce('Inter'); // bundled font

		await appearanceCommand.run(ctx);

		const editor = new ConfigEditor(tempConfigPath);
		expect(editor.get('user.appearance.font_name')).toBe('Inter');
		expect(editor.get('user.appearance.font_url')).toBeUndefined();
	});
});
