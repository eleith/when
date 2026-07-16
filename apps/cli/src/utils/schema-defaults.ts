// Reads a field's `default`/`description` straight off an exported TypeBox
// object schema so prompts never hardcode (and drift from) schema values.
type SchemaLike = { properties: Record<string, unknown> };

export function schemaDefault<T = unknown>(schema: SchemaLike, key: string): T {
	return (schema.properties[key] as { default?: unknown } | undefined)?.default as T;
}

export function schemaDescription(schema: SchemaLike, key: string): string | undefined {
	return (schema.properties[key] as { description?: string } | undefined)?.description;
}
