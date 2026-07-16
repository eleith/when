import { describe, expect, test } from 'vitest';
import { AppearanceSchema } from '@when/config';
import { schemaDefault, schemaDescription } from './schema-defaults.ts';

describe('schema-defaults', () => {
	test('reads inline and ref-wrapped defaults off the appearance schema', () => {
		expect(schemaDefault(AppearanceSchema, 'title')).toBe('if not now, when?');
		expect(schemaDefault(AppearanceSchema, 'description')).toBe('find some time and we can meet');
		expect(schemaDefault(AppearanceSchema, 'primary_light_color')).toBe('#166534');
		expect(schemaDefault(AppearanceSchema, 'primary_dark_color')).toBe('#34d399');
	});

	test('reads field descriptions', () => {
		expect(schemaDescription(AppearanceSchema, 'title')).toBe('Title of the booking page.');
	});

	test('returns undefined for an unknown key', () => {
		expect(schemaDefault(AppearanceSchema, 'nope')).toBeUndefined();
	});
});
