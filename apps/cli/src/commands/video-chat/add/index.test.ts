import { describe, expect, test } from 'vitest';
import { addCommand } from './index.ts';

describe('video-chat add command structure', () => {
	test('command is defined with correct properties', () => {
		expect(addCommand.name).toBe('add');
		expect(addCommand.description).toBe('Add video chat integrations');
		expect(addCommand.subCommands).toHaveProperty('google-meet');
		expect(addCommand.subCommands).toHaveProperty('nextcloud-talk');
	});
});
