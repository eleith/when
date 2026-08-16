import { describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from './$types';
import { GET } from './+server';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('$lib/server/state', () => ({
	getConfig: () => validConfig
}));

describe('GET /assets/images/avatar.svg', () => {
	test('returns SVG content-type and valid SVG XML', async () => {
		const response = await GET({} as RequestEvent);

		expect(response.headers.get('content-type')).toBe('image/svg+xml');
		expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
		const text = await response.text();
		expect(text).toContain('<svg');
		expect(text).not.toContain('<text');
	});
});
