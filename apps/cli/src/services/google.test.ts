import { describe, expect, test } from 'vitest';
import { extractAuthCode } from './google.ts';

describe('extractAuthCode', () => {
	test('returns a bare code unchanged', () => {
		expect(extractAuthCode('4/0Abc_def')).toBe('4/0Abc_def');
	});

	test('extracts the code from a pasted redirect URL', () => {
		expect(extractAuthCode('http://localhost/?code=4/0Abc&scope=cal')).toBe('4/0Abc');
	});

	test('extracts the code when it is not the first query param', () => {
		expect(extractAuthCode('https://localhost/cb?state=x&code=tok-123')).toBe('tok-123');
	});

	test('falls back to the raw input when a code=… string is not a valid URL', () => {
		expect(extractAuthCode('code=not-a-url')).toBe('code=not-a-url');
	});

	test('falls back to the input when a URL has no code param', () => {
		expect(extractAuthCode('http://localhost/?state=x')).toBe('http://localhost/?state=x');
	});
});
