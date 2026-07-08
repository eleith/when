import type { Appearance } from '@when/config';
import { getContrastText } from './color.js';

export function getHeadInjections(appearance: Appearance): string {
	let headInjections = '';

	if (appearance.font_url) {
		headInjections += `<link rel="stylesheet" href="${appearance.font_url}">\n\t\t`;
	}

	const textOnPrimaryLight = getContrastText(appearance.primary_light_color);
	const textOnPrimaryDark = getContrastText(appearance.primary_dark_color);

	const fontDecl = appearance.font_name ? `--font-family: ${appearance.font_name};` : '';

	const styleTag = `<style>
		:root {
			--primary: ${appearance.primary_light_color};
			--text: ${appearance.text_light_color};
			--surface-page: ${appearance.background_light_color};
			--text-on-primary: ${textOnPrimaryLight};
			${fontDecl}
		}

		@media (prefers-color-scheme: dark) {
			:root {
				--primary: ${appearance.primary_dark_color};
				--text: ${appearance.text_dark_color};
				--surface-page: ${appearance.background_dark_color};
				--text-on-primary: ${textOnPrimaryDark};
			}
		}
	</style>`;
	headInjections += styleTag;

	return headInjections;
}
