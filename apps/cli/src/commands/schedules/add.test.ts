import { describe, expect, test, vi, beforeEach } from 'vitest';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { text, multiselect } from '@clack/prompts';
import { ConfigEditor } from '@when/config';
import { schedulesAddCommand } from './add.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

vi.mock('@clack/prompts', () => {
	return {
		text: vi.fn(),
		multiselect: vi.fn(),
		isCancel: vi.fn().mockReturnValue(false),
		spinner: vi.fn().mockReturnValue({
			start: vi.fn(),
			message: vi.fn(),
			stop: vi.fn()
		})
	};
});

describe('schedules add command', () => {
	const tempConfigPath = resolve(__dirname, 'config.test.yaml');

	beforeEach(() => {
		vi.restoreAllMocks();
		if (existsSync(tempConfigPath)) {
			unlinkSync(tempConfigPath);
		}
	});

	test('fails if config file does not exist', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const originalExitCode = process.exitCode;
		process.exitCode = undefined;

		try {
			const ctx = {
				values: { config: 'nonexistent-config.yaml' },
				positionals: [],
				commandPath: []
			} as unknown as Parameters<NonNullable<typeof schedulesAddCommand.run>>[0];

			await schedulesAddCommand.run!(ctx);

			expect(process.exitCode).toBe(1);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('FAIL  No configuration file found at:')
			);
		} finally {
			errorSpy.mockRestore();
			process.exitCode = originalExitCode;
		}
	});

	test('prompts and adds profile to config.yaml', async () => {
		// Create a minimal config.yaml
		writeFileSync(
			tempConfigPath,
			`
schedules:
  - name: standard
    weekly:
      monday: ["09:00-17:00"]
`
		);

		vi.mocked(text)
			.mockResolvedValueOnce('custom-profile') // schedule name
			.mockResolvedValueOnce('10:00-16:00'); // hours

		vi.mocked(multiselect).mockResolvedValueOnce(['monday', 'wednesday', 'friday']); // working days

		const ctx = {
			values: { config: tempConfigPath },
			positionals: [],
			commandPath: []
		} as unknown as Parameters<NonNullable<typeof schedulesAddCommand.run>>[0];

		await schedulesAddCommand.run!(ctx);

		const editor = new ConfigEditor(tempConfigPath);
		const profiles =
			(editor.get('schedules') as Array<{ name: string; weekly: Record<string, string[]> }>) ?? [];
		expect(profiles).toHaveLength(2);
		expect(profiles[1]).toEqual({
			name: 'custom-profile',
			weekly: {
				monday: ['10:00-16:00'],
				wednesday: ['10:00-16:00'],
				friday: ['10:00-16:00']
			}
		});

		// Cleanup
		unlinkSync(tempConfigPath);
	});
});
