import { expect, test } from 'vitest';
import { safeCallbackUrl } from './callback-url';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

test.for([
	'https://evil.com/x',
	'//evil.com',
	'/\\evil.com',
	'\\\\evil.com',
	'\\/evil.com',
	'javascript:alert(1)',
	'http://callback.invalid.evil.com/x',
	'',
	null
])('sends %s to the admin dashboard instead', (value) => {
	expect(safeCallbackUrl(value)).toBe('/admin');
});

test('a deep path survives with its query and hash', () => {
	expect(safeCallbackUrl('/admin/appointments/pending?page=2#row-7')).toBe(
		'/admin/appointments/pending?page=2#row-7'
	);
});

test('a header break cannot reach the location', () => {
	expect(safeCallbackUrl(`/admin${CR}${LF}Set-Cookie: a=b`)).not.toContain(CR);
	expect(safeCallbackUrl(`/admin${CR}${LF}Set-Cookie: a=b`)).not.toContain(LF);
});
