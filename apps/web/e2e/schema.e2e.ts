import { expect, test } from './support/test.ts';
import { signInAsAdmin } from './support/auth.ts';

test('schema.json is public, production-packaged, and independent of instance configuration', async ({
	page,
	request
}) => {
	const anonymous = await request.get('/schema.json');
	expect(anonymous.status()).toBe(200);
	expect(anonymous.headers()['content-type']).toBe('application/schema+json; charset=utf-8');
	expect(anonymous.headers()['cache-control']).toBe('public, max-age=0, must-revalidate');
	expect(anonymous.headers().location).toBeUndefined();
	const text = await anonymous.text();
	const schema = JSON.parse(text);
	expect(schema.title).toBe('When configuration');
	expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
	expect(schema.$defs.Meeting.required).toContain('title');
	expect(schema.$defs.Meeting.required).not.toContain('duration_minutes');
	for (const instanceValue of [
		'E2E Fixture',
		'e2e-admin-password',
		'e2e-smtp-password',
		'e2e-caldav-password',
		'e2e-video-password'
	]) {
		expect(text).not.toContain(instanceValue);
	}

	await signInAsAdmin(page);
	const signedIn = await page.request.get('/schema.json?include=config&role=host');
	expect(signedIn.status()).toBe(200);
	const signedInSchema = await signedIn.json();
	expect(signedInSchema).toEqual(schema);
});
