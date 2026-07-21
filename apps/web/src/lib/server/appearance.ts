import type { Appearance } from '@when/config';
import { getContrastText } from './color.js';
import { fontStack } from './fonts.js';

export function getHeadInjections(appearance: Appearance): string {
	let headInjections = '';

	if (appearance.font_url) {
		headInjections += `<style>
		@font-face {
			font-family: '${appearance.font_name}';
			src: url('${appearance.font_url}') format('woff2');
			font-display: swap;
		}
	</style>\n\t\t`;
	}

	const textOnPrimaryLight = getContrastText(
		appearance.primary_light_color,
		appearance.text_light_color
	);
	const textOnPrimaryDark = getContrastText(
		appearance.primary_dark_color,
		appearance.text_dark_color
	);

	const fontDecl = `--when-font-family: ${fontStack(appearance.font_name)};`;

	const styleTag = `<style>
		:root {
			--when-color-primary: ${appearance.primary_light_color};
			--when-color-text: ${appearance.text_light_color};
			--when-color-surface-page: ${appearance.background_light_color};
			--when-color-text-on-primary: ${textOnPrimaryLight};
			${fontDecl}
		}

		@media (prefers-color-scheme: dark) {
			:root {
				--when-color-primary: ${appearance.primary_dark_color};
				--when-color-text: ${appearance.text_dark_color};
				--when-color-surface-page: ${appearance.background_dark_color};
				--when-color-text-on-primary: ${textOnPrimaryDark};
			}
		}
	</style>`;
	headInjections += styleTag;

	return headInjections;
}
