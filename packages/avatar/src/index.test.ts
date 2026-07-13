import { expect, test } from 'vitest';
import { defaultAvatar } from './index.js';

test('renders an svg and a matching data uri', () => {
	const avatar = defaultAvatar('Jane Doe');
	expect(avatar.svg.startsWith('<svg')).toBe(true);
	expect(avatar.dataUri.startsWith('data:image/svg+xml')).toBe(true);
});

test('is deterministic for the same seed', () => {
	expect(defaultAvatar('Jane Doe').svg).toBe(defaultAvatar('Jane Doe').svg);
});

test('produces different avatars for different seeds', () => {
	expect(defaultAvatar('Alice').svg).not.toBe(defaultAvatar('Bob').svg);
});
