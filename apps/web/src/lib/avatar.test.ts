import { expect, test } from 'vitest';
import { avatarThumbnailUrl } from './avatar';

test('uses the configured path as the thumbnail URL path, not a query parameter', () => {
	expect(avatarThumbnailUrl('/public/photo.webp')).toBe('/avatar/public/photo.webp?thumbnail=true');
});

test('preserves source query parameters and SVG fragments', () => {
	expect(avatarThumbnailUrl('/public/photo.svg?revision=2#face')).toBe(
		'/avatar/public/photo.svg?revision=2&thumbnail=true#face'
	);
});

test('encodes filenames without encoding their path separators', () => {
	expect(avatarThumbnailUrl('/public/profile photo.webp')).toBe(
		'/avatar/public/profile%20photo.webp?thumbnail=true'
	);
	expect(avatarThumbnailUrl('/public/profile%20photo.webp')).toBe(
		'/avatar/public/profile%20photo.webp?thumbnail=true'
	);
});

test('the thumbnail selector cannot be overridden by the configured source query', () => {
	expect(avatarThumbnailUrl('/public/photo.webp?thumbnail=false')).toBe(
		'/avatar/public/photo.webp?thumbnail=true'
	);
});
