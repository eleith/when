import { expect, test } from 'vitest';
import { GET } from './+server';

test('GET /schema/config.json returns the canonical JSON Schema', async () => {
	const res = GET();
	expect(res.status).toBe(200);
	expect(res.headers.get('content-type')).toContain('application/json');
	const body = await res.json();
	expect(body.$id).toBe('https://when.app/schema/config.json');
	expect(body.title).toBe('When configuration');
	expect(body.$defs?.Auth).toBeDefined();
});
