import type { Appearance } from '@when/config';
import { getContrastText } from './color.js';
import { fontFamilies } from './fonts.js';

// A <style> element ends at the first `</style`, whatever CSS quoting says, so `<` goes too.
function cssString(value: string): string {
	const escaped = value
		.replace(/[\\']/g, '\\$&')
		.replace(/</g, '\\3c ')
		.replace(/[\r\n]+/g, ' ');
	return `'${escaped}'`;
}

function fontFaceRule(appearance: Appearance): string {
	if (!appearance.font_url) return '';
	return `@font-face {
			font-family: ${cssString(appearance.font_name)};
			src: url(${cssString(appearance.font_url)}) format('woff2');
			font-display: swap;
		}`;
}

function colorVariables(appearance: Appearance, scheme: 'light' | 'dark'): string {
	const primary =
		scheme === 'light' ? appearance.primary_light_color : appearance.primary_dark_color;
	const text = scheme === 'light' ? appearance.text_light_color : appearance.text_dark_color;
	const surface =
		scheme === 'light' ? appearance.background_light_color : appearance.background_dark_color;

	return `--when-color-primary: ${primary};
			--when-color-text: ${text};
			--when-color-surface-page: ${surface};
			--when-color-text-on-primary: ${getContrastText(primary, text)};`;
}

/** The owner's configured theme, as a <style> element for the document head. */
export function themeStyleTag(appearance: Appearance): string {
	const families = fontFamilies(appearance.font_name).map(cssString).join(', ');

	return `<style>
		${fontFaceRule(appearance)}
		:root {
			${colorVariables(appearance, 'light')}
			--when-font-family: ${families};
		}

		@media (prefers-color-scheme: dark) {
			:root {
				${colorVariables(appearance, 'dark')}
			}
		}
	</style>`;
}
