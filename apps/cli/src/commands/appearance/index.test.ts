import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { text } from '@clack/prompts';
import { ConfigEditor } from '@when/config';
import { appearanceCommand } from './index.ts';

vi.mock('@clack/prompts', () => {
	return {
		text: vi.fn(),
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

	test('saves appearance overrides to config.yaml', async () => {
		writeFileSync(tempConfigPath, 'user:\n  name: "Jane Doe"\n');

		vi.mocked(text)
			.mockResolvedValueOnce('My Scheduling Page') // title
			.mockResolvedValueOnce('Description of booking page') // description
			.mockResolvedValueOnce('#123456') // primary_light_color
			.mockResolvedValueOnce('#abcdef') // primary_dark_color
			.mockResolvedValueOnce('Outfit'); // font_name

		const ctx = {
			values: { config: tempConfigPath },
			positionals: [],
			commandPath: []
		} as unknown as Parameters<typeof appearanceCommand.run>[0];

		await appearanceCommand.run(ctx);

		const editor = new ConfigEditor(tempConfigPath);
		expect(editor.get('user.appearance.title')).toBe('My Scheduling Page');
		expect(editor.get('user.appearance.description')).toBe('Description of booking page');
		expect(editor.get('user.appearance.primary_light_color')).toBe('#123456');
		expect(editor.get('user.appearance.primary_dark_color')).toBe('#abcdef');
		expect(editor.get('user.appearance.font_name')).toBe('Outfit');
	});
});
