// Dev-only module resolve hook: lets Node run @when/* TypeScript source directly.
//
// Source is written with NodeNext-style '.js' import specifiers that actually
// point at '.ts' files on disk (the packages use moduleResolution: "bundler",
// which lets bundlers try '.ts' — Node's own resolver is literal and will not).
// So we redirect './foo.js' -> './foo.ts' whenever the sibling source exists.
//
// This is the ONLY thing Node needs from us: Node 26 strips the types itself, so
// there is no transform/load hook here. Never used in production — prod runs the
// compiled dist/, where the '.js' specifiers already resolve to real '.js' files.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function resolve(specifier, context, nextResolve) {
	const relative = specifier.startsWith('./') || specifier.startsWith('../');
	if (relative && specifier.endsWith('.js') && context.parentURL) {
		const tsSpecifier = specifier.slice(0, -3) + '.ts';
		const tsUrl = new URL(tsSpecifier, context.parentURL);
		if (existsSync(fileURLToPath(tsUrl))) {
			return nextResolve(tsSpecifier, context);
		}
	}
	return nextResolve(specifier, context);
}
