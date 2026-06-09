import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Derive an editor-facing schema from the canonical one. The canonical schema
// keeps defaulted fields `required` so the generated TypeScript types are strict
// (non-optional) — ajv fills the defaults at load. But an editor pointed at the
// raw schema would wrongly flag those defaulted fields as missing, since it does
// not apply ajv's defaults. This relaxed copy drops them from every `required`.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const schema = JSON.parse(readFileSync(join(srcDir, 'config.schema.json'), 'utf8'));

relax(schema);

writeFileSync(
	join(srcDir, 'config.external.schema.json'),
	JSON.stringify(schema, null, '\t') + '\n'
);

/** Drop any `required` entry whose property declares a `default`. */
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
