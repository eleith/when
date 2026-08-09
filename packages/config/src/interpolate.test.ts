import { expect, test } from 'vitest';
import { interpolate, MissingEnvVarsError } from './interpolate.js';

test('replaces single env var in a string', () => {
	const result = interpolate({ host: '${SMTP_HOST}' }, { SMTP_HOST: 'smtp.example.com' });
	expect(result).toEqual({ host: 'smtp.example.com' });
});

test('replaces multiple vars in the same string', () => {
	const result = interpolate({ url: 'https://${USER}:${PASS}@host' }, { USER: 'jane', PASS: 'pw' });
	expect(result).toEqual({ url: 'https://jane:pw@host' });
});

test('walks nested objects and arrays', () => {
	const input = {
		smtp: { password: '${SMTP_PASS}' },
		calendars: [
			{ id: 'a', password: '${CAL_A_PASS}' },
			{ id: 'b', password: '${CAL_B_PASS}' }
		]
	};
	const result = interpolate(input, {
		SMTP_PASS: 's3cret',
		CAL_A_PASS: 'a-pw',
		CAL_B_PASS: 'b-pw'
	});
	expect(result).toEqual({
		smtp: { password: 's3cret' },
		calendars: [
			{ id: 'a', password: 'a-pw' },
			{ id: 'b', password: 'b-pw' }
		]
	});
});

test('throws MissingEnvVarsError listing every missing var', () => {
	const input = {
		a: '${VAR_ONE}',
		b: ['${VAR_TWO}', '${VAR_THREE}'],
		c: { d: '${VAR_ONE}' }
	};
	const fn = () => interpolate(input, {});
	expect(fn).toThrow(MissingEnvVarsError);
	try {
		fn();
	} catch (err) {
		expect((err as MissingEnvVarsError).missing).toEqual(['VAR_ONE', 'VAR_THREE', 'VAR_TWO']);
	}
});

test('leaves non-string values alone', () => {
	const input = { port: 587, tls: true, retries: null, tags: ['a'] };
	const result = interpolate(input, {});
	expect(result).toEqual(input);
});

test('uses ${VAR:-default} fallback when the var is unset', () => {
	const result = interpolate({ url: '${APP_URL:-http://localhost:8080}' }, {});
	expect(result).toEqual({ url: 'http://localhost:8080' });
});

test('prefers the env value over a ${VAR:-default} fallback', () => {
	const result = interpolate(
		{ url: '${APP_URL:-http://localhost:8080}' },
		{ APP_URL: 'https://x' }
	);
	expect(result).toEqual({ url: 'https://x' });
});

test('${VAR:-} yields an empty string when unset (no throw)', () => {
	expect(interpolate({ v: '${MAYBE:-}' }, {})).toEqual({ v: '' });
});

test('$$ escapes to a literal dollar sign', () => {
	expect(interpolate({ price: '$$5 and $${NOPE}' }, {})).toEqual({ price: '$5 and ${NOPE}' });
});

test('leaves bare $VAR (no braces) alone', () => {
	const result = interpolate({ text: 'price is $5 and $FOO' }, {});
	expect(result).toEqual({ text: 'price is $5 and $FOO' });
});

test('replaces multiple vars with env containing special chars', () => {
	const result = interpolate({ secret: '${WEIRD}' }, { WEIRD: 'a:b#c$d${not_expanded}' });
	expect(result).toEqual({ secret: 'a:b#c$d${not_expanded}' });
});
