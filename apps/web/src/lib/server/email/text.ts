/** Joins plaintext lines, dropping nullish/false entries but keeping empty strings as blank lines. */
export function lines(...parts: (string | false | null | undefined)[]): string {
	return parts.filter((p) => p !== null && p !== undefined && p !== false).join('\n');
}
