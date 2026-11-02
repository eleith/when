export const FALLBACK_FONT_NAME = 'Noto Sans';

// NOTE: the CLI appearance wizard keeps its own copy of these family names; keep in sync.
const BUNDLED_FONT_WEIGHTS: Record<string, number[]> = {
	'noto sans': [400, 600, 700],
	lato: [400, 700],
	outfit: [400, 600, 700],
	inter: [400, 600, 700]
};

export function isBundledFont(family: string): boolean {
	return Object.hasOwn(BUNDLED_FONT_WEIGHTS, family.toLowerCase());
}

export function bundledFontUrls(family: string): string[] {
	if (!isBundledFont(family)) return [];
	const key = family.toLowerCase();
	const slug = key.replaceAll(' ', '-');
	return (BUNDLED_FONT_WEIGHTS[key] ?? []).map(
		(weight) => `/assets/fonts/${slug}/${slug}-latin-${weight}-normal.woff2`
	);
}

/** Preload only the configured face; leave other weights and fallbacks on demand. */
export function primaryFontUrl(family: string, customPath?: string): string | null {
	return customPath ?? bundledFontUrls(family)[0] ?? null;
}

export function fontFamilies(family: string): string[] {
	return isBundledFont(family) ? [family] : [family, FALLBACK_FONT_NAME];
}

export function fontStack(family: string): string {
	return fontFamilies(family).join(', ');
}
