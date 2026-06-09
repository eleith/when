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

test('serves the relaxed schema so editors do not flag defaulted fields', async () => {
	const body = await (await GET()).json();
	// `database` has a default, so it is not required of the user.
	expect(body.required).not.toContain('database');
	expect(body.$defs?.DatabaseConfig?.required).toBeUndefined();
});
