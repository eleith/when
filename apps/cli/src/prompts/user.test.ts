import { describe, expect, test, vi, beforeEach } from 'vitest';
import { text } from '@clack/prompts';
import { promptUser } from './user.ts';

vi.mock('@clack/prompts', () => ({
	text: vi.fn(),
	isCancel: vi.fn().mockReturnValue(false)
}));

describe('promptUser', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	test('collects name, email, and timezone with no env vars', async () => {
		vi.mocked(text)
			.mockResolvedValueOnce('Jane Doe') // name
			.mockResolvedValueOnce('jane@example.com') // email
			.mockResolvedValueOnce('Europe/Berlin'); // timezone

		const result = await promptUser();

		expect(result).toEqual({
			value: { name: 'Jane Doe', email: 'jane@example.com', timezone: 'Europe/Berlin' },
			envVars: []
		});
	});
});
