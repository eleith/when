import { isDeepStrictEqual } from 'node:util';
import type { WhenConfiguration } from './schema.js';

export function configChanged(
	previous: WhenConfiguration,
	next: WhenConfiguration,
	keys: (keyof WhenConfiguration)[]
): boolean {
	return keys.some((key) => !isDeepStrictEqual(previous[key], next[key]));
}
