import { expect, test } from 'vitest';
import { locateInYaml } from './locate.js';

const yaml = `user:
  name: 'Jane'
  email: 'not-an-email'
calendars:
  - name: 'work'
    provider: 'dav'
  - name: 'home'
    provider: 'missing'
`;

test('locates a nested scalar', () => {
	expect(locateInYaml(yaml, '/user/email')).toEqual({ line: 3, column: 10 });
});

test('locates an array element by index', () => {
	expect(locateInYaml(yaml, '/calendars/1/provider')).toEqual({ line: 8, column: 15 });
});

test('locates the container itself', () => {
	expect(locateInYaml(yaml, '/calendars/1')).toEqual({ line: 7, column: 5 });
});

// Issues can name a field the loader derived, which never appears in the source.
test('falls back to the nearest ancestor present in the file', () => {
	expect(locateInYaml(yaml, '/calendars/1/sync/refresh_every_minutes')).toEqual({
		line: 7,
		column: 5
	});
});

test('an unresolvable pointer falls back to the document root', () => {
	expect(locateInYaml(yaml, '/meetings/0/slug')).toEqual({ line: 1, column: 1 });
});

test('unescapes JSON Pointer tokens', () => {
	expect(locateInYaml(`a~b:\n  c: 1\n`, '/a~0b/c')).toEqual({ line: 2, column: 6 });
});
