import { expect, test } from 'vitest';
import { defaultAvatar } from './avatar';

test('renders a deterministic svg from a seed', () => {
	expect(defaultAvatar('Jane Doe').startsWith('<svg')).toBe(true);
	expect(defaultAvatar('Jane Doe')).toBe(defaultAvatar('Jane Doe'));
});

test('produces different avatars for different seeds', () => {
	expect(defaultAvatar('Alice')).not.toBe(defaultAvatar('Bob'));
});

test('applies brand background and text colors', () => {
	const svg = defaultAvatar('Jane Doe', { backgroundColor: '#166534', textColor: '#ededed' });
	expect(svg).toContain('#166534');
	expect(svg).toContain('#ededed');
});
