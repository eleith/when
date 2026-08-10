import type { Appearance } from '@when/config';
import { tint } from './color.js';

export interface EmailTheme {
	pageBg: string;
	surface: string;
	text: string;
	bodyText: string;
	label: string;
	border: string;
	dangerText: string;
	dangerBorder: string;
	cardRadius: string;
}

// Shares mirror the web app's theme.css tokens: text-secondary, text-muted, border.
const BODY_TEXT_SHARE = 0.85;
const LABEL_SHARE = 0.78;
const BORDER_SHARE = 0.1;

export function emailTheme(appearance: Appearance): EmailTheme {
	const pageBg = appearance.background_light_color;
	const text = appearance.text_light_color;
	return {
		pageBg,
		surface: '#ffffff',
		text,
		bodyText: tint(text, pageBg, BODY_TEXT_SHARE),
		label: tint(text, pageBg, LABEL_SHARE),
		border: tint(text, pageBg, BORDER_SHARE),
		dangerText: '#b91c1c',
		dangerBorder: '#fecaca',
		cardRadius: '10px'
	};
}
