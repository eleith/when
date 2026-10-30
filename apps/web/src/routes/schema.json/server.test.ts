import { describe, expect, test, vi } from 'vitest';
import editorSchema from '@when/config/schema.json' with { type: 'json' };
import { GET } from './+server';

const getConfig = vi.hoisted(() =>
	vi.fn(() => {
		throw new Error('Schema must not read instance configuration');
	})
);
vi.mock('#lib/server/state.js', () => ({ getConfig }));

describe('GET /schema.json', () => {
	test('returns only the bundled editor schema with the schema media type', async () => {
		const response = GET();
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/schema+json; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
		const body = await response.json();
		expect(body).toEqual(editorSchema);
		expect(getConfig).not.toHaveBeenCalled();
	});

	test('does not let a response consumer mutate the bundled schema for later requests', async () => {
		const response = GET();
		const body = await response.json();
		body.title = 'Not the schema';
		const next = GET();
		const nextBody = await next.json();
		expect(nextBody).toEqual(editorSchema);
		expect(getConfig).not.toHaveBeenCalled();
	});
});
