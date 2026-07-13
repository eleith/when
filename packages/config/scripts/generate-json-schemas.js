import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schemas from '../src/schema.ts';
import { DERIVED_OPTIONAL } from '../src/normalize.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

const defs = {};
for (const [key, value] of Object.entries(schemas)) {
	if (key.endsWith('Schema') && key !== 'WhenConfigurationSchema') {
		const name = key.replace(/Schema$/, '');
		defs[name] = JSON.parse(JSON.stringify(value));
	}
}

const schema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	$id: 'https://when.app/schema/config.json',
	...JSON.parse(JSON.stringify(schemas.WhenConfigurationSchema)),
	$defs: defs
};

function processNode(node, isRoot = true) {
	if (!node || typeof node !== 'object') return;
	if (typeof node.$ref === 'string' && !node.$ref.startsWith('#')) {
		node.$ref = `#/$defs/${node.$ref}`;
	}
	if (!isRoot && node.$id !== undefined) {
		delete node.$id;
	}
	for (const child of Object.values(node)) {
		processNode(child, false);
	}
}

processNode(schema, true);

// Relax the schema (drop required fields with defaults)
function relax(node) {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node.required) && node.properties) {
		node.required = node.required.filter((key) => !('default' in (node.properties[key] ?? {})));
		if (node.required.length === 0) delete node.required;
	}
	for (const child of Object.values(node.properties ?? {})) relax(child);
	for (const def of Object.values(node.$defs ?? {})) relax(def);
	for (const key of ['allOf', 'anyOf', 'oneOf', 'then', 'else', 'items']) {
		const value = node[key];
		if (Array.isArray(value)) value.forEach(relax);
		else if (value) relax(value);
	}
}

relax(schema);

// Relax fields filled by the loader's normalize pass (no static `default`, so
// `relax` above leaves them required). The definition + field names come from
// @when/config's DERIVED_OPTIONAL so the two can't drift.
for (const [defName, fields] of Object.entries(DERIVED_OPTIONAL)) {
	const def = schema.$defs?.[defName];
	if (!Array.isArray(def?.required)) continue;
	def.required = def.required.filter((key) => !fields.includes(key));
	if (def.required.length === 0) delete def.required;
}

// Write to config.schema.json
writeFileSync(join(srcDir, 'config.schema.json'), JSON.stringify(schema, null, '\t') + '\n');
