import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import * as config from '@when/config';

const examplePath = join(process.cwd(), 'config', 'when.example.yml');
const exampleText = readFileSync(examplePath, 'utf8');

// Field names the example intentionally leaves undocumented (none today). Add a
// field here, with a reason, if it should be exempt from the coverage check.
const OMITTED = new Set<string>([]);

type SchemaNode = { properties?: Record<string, unknown>; anyOf?: unknown[]; items?: unknown };

function collectFieldNames(node: unknown, acc: Set<string>): void {
	if (node === null || typeof node !== 'object') return;
	const n = node as SchemaNode;
	if (n.properties) {
		for (const [key, child] of Object.entries(n.properties)) {
			acc.add(key);
			collectFieldNames(child, acc);
		}
	}
	if (Array.isArray(n.anyOf)) for (const child of n.anyOf) collectFieldNames(child, acc);
	if (n.items) collectFieldNames(n.items, acc);
}

// Every field name across the exported schemas (object properties, union
// variants, and array items), so a new schema field is discovered here.
function allSchemaFieldNames(): Set<string> {
	const names = new Set<string>();
	for (const [name, value] of Object.entries(config)) {
		if (name.endsWith('Schema')) collectFieldNames(value, names);
	}
	return names;
}

describe('config/when.example.yml', () => {
	test('is a structurally valid config', () => {
		expect(() => config.validateStructure(parseYaml(exampleText))).not.toThrow();
	});

	test('documents every schema field (as a key or a comment)', () => {
		const missing = [...allSchemaFieldNames()].filter(
			(field) => !OMITTED.has(field) && !new RegExp(`\\b${field}\\b`).test(exampleText)
		);
		expect(missing).toEqual([]);
	});
});
