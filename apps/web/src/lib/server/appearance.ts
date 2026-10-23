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
	if (!appearance.font_path) return '';
	return `@font-face {
			font-family: ${cssString(appearance.font_name)};
			src: url(${cssString(appearance.font_path)}) format('woff2');
			font-display: swap;
		}`;
}

function colorVariables(appearance: Appearance): string {
	const contrastLight = getContrastText(
		appearance.primary_light_color,
		appearance.text_light_color
	);
	const contrastDark = getContrastText(appearance.primary_dark_color, appearance.text_dark_color);

	return `--when-color-primary: light-dark(${appearance.primary_light_color}, ${appearance.primary_dark_color});
			--when-color-text: light-dark(${appearance.text_light_color}, ${appearance.text_dark_color});
			--when-color-surface-page: light-dark(${appearance.background_light_color}, ${appearance.background_dark_color});
			--when-color-text-on-primary: light-dark(${contrastLight}, ${contrastDark});`;
}

/** The owner's configured theme, as a <style> element for the document head. */
export function themeStyleTag(appearance: Appearance): string {
	const families = fontFamilies(appearance.font_name).map(cssString).join(', ');

	return `<style>
		${fontFaceRule(appearance)}
		:root {
			${colorVariables(appearance)}
			--when-font-family: ${families};
		}
	</style>`;
}
