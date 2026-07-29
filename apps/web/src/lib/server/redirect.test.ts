import { expect, test } from 'vitest';
import { localRedirect } from './redirect';

const ORIGIN = 'http://localhost';
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

test.for([
	'https://evil.com/x',
	'//evil.com',
	'/\\evil.com',
	'\\\\evil.com',
	'\\/evil.com',
	'javascript:alert(1)',
	'http://localhost.evil.com/x',
	'http://localhost:9999/other',
	'',
	null
])('sends %s to the fallback instead', (value) => {
	expect(localRedirect(value, ORIGIN, '/admin')).toBe('/admin');
});

test('a deep path survives with its query and hash', () => {
	expect(localRedirect('/admin/appointments/pending?page=2#row-7', ORIGIN, '/admin')).toBe(
		'/admin/appointments/pending?page=2#row-7'
	);
});

test('an absolute url on the same origin reduces to its path', () => {
	expect(localRedirect(`${ORIGIN}/admin/appointments/past?page=2`, ORIGIN, '/admin')).toBe(
		'/admin/appointments/past?page=2'
	);
});

test('a header break cannot reach the location', () => {
	const value = `/admin${CR}${LF}Set-Cookie: a=b`;
	expect(localRedirect(value, ORIGIN, '/admin')).not.toContain(CR);
	expect(localRedirect(value, ORIGIN, '/admin')).not.toContain(LF);
});
