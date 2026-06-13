// Neutral design tokens shared by the email templates. Brand-derived colors
// (primary / onPrimary) live on `Brand`; everything here is brand-independent.
export const emailTheme = {
	pageBg: '#f3f4f6',
	surface: '#ffffff',
	text: '#1a1a1a',
	bodyText: '#4b5563',
	label: '#6b7280',
	border: '#d1d5db',
	dangerText: '#b91c1c',
	dangerBorder: '#fecaca',
	cardRadius: '10px'
} as const;
