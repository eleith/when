import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import generatedSchema from './config.schema.json' with { type: 'json' };

function references(value: unknown): string[] {
	if (value === null || typeof value !== 'object') return [];
	const refs: string[] = [];
	if ('$ref' in value && typeof value.$ref === 'string') refs.push(value.$ref);
	for (const child of Object.values(value)) refs.push(...references(child));
	return refs;
}

describe('public editor schema asset', () => {
	test('exports the generated schema and includes the same asset in the compiled package', async () => {
		// The production export is available after build, not during source typechecking.
		const schemaPath = '@when/config/schema.json';
		const exported = await import(schemaPath, { with: { type: 'json' } });
		expect(exported.default).toEqual(generatedSchema);
		const compiledText = readFileSync(
			new URL('../dist/src/config.schema.json', import.meta.url),
			'utf8'
		);
		const compiled = JSON.parse(compiledText);
		expect(compiled).toEqual(generatedSchema);
	});

	test('retains editor-friendly optional defaults and self-contained references', () => {
		expect(generatedSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
		expect(generatedSchema.properties.version.default).toBe(1);
		expect(generatedSchema.required).not.toContain('version');
		expect(generatedSchema.required).not.toContain('providers');
		expect(generatedSchema.$defs.Meeting.required).toContain('title');
		expect(generatedSchema.$defs.Meeting.required).not.toContain('duration_minutes');
		const refs = references(generatedSchema);
		expect(refs.length).toBeGreaterThan(0);
		for (const reference of refs) expect(reference).toMatch(/^#/);
	});
});
